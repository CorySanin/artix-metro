const fs = require('fs');
const fsp = fs.promises;
const readline = require('readline');
const path = require('path');
const spawn = require('child_process').spawn;
const clc = require('cli-color');
const JSON5 = require('json5');
const puppeteer = require('puppeteer');
const comparepkg = require('./comparepkg');

const SELECTORS = {
    login_username: '#j_username',
    login_password: 'input[name=j_password]',
    login_button: '.submit button',
    login_finish: '#breadcrumbBar',
    build_row: '#buildHistory .build-row:nth-of-type(2)',
    build_timestamp: '#buildHistory .build-row:nth-of-type(2) div:nth-of-type(2) .build-link',
    build_icon_outer_ring: '#buildHistory .build-row:nth-of-type(2) .build-status-icon__outer svg'
}

const BUILDAGE = process.env.BUILDAGE || 3;
let JOB = process.env.JOB;
let START = null;

/**
 * Sleep equivalent as a promise
 * @param {number} ms Number of ms
 * @returns Promise<void>
 */
const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for a new build to succeed
 * @param {puppeteer.Page} page 
 */
async function waitForBuild(page) {
    let timestamp, outerRing;
    let updateVars = async () => {
        timestamp = await page.$(SELECTORS.build_timestamp);
        outerRing = await page.$(SELECTORS.build_icon_outer_ring);
    }

    await page.waitForSelector(SELECTORS.build_row);
    let foundBuild = false;
    while (!foundBuild) {
        await updateVars();
        if (timestamp) {
            let ts = await (await timestamp.getProperty('innerText')).jsonValue();
            let timeDiff = (new Date()).getTime() - (new Date(ts)).getTime();
            if (!(foundBuild = BUILDAGE * 60000 > timeDiff)) {// 60 minutes * 1000 ms
                await snooze(5000);
            }
        }
        else {
            console.debug('No timestamp (perhaps pending)');
            await snooze(30000);
        }
    }
    console.log(clc.greenBright('Build found'));
    let status;
    while ((await updateVars()) || !outerRing ||
        (status = await outerRing.evaluate(E => E.getAttribute('tooltip'))).startsWith('In progress')) {
        await snooze(5000);
    }
    if (!status.startsWith('Success')) {
        throw `Build failed. Status: "${status}"`;
    }
}

/**
 * Run a command (as a promise). Ignores exit code.
 * @param {string} command 
 * @param {string[]} args 
 * @returns Promise<number>
 */
function runCommand(command, args = []) {
    return new Promise((res, reject) => {
        let proc = spawn(command, args, { stdio: ['ignore', process.stdout, process.stderr] });
        proc.on('exit', code => {
            res(code);
        });
    });
}

/**
 * Locate the package directory
 * @param {string} package 
 * @returns path to package
 */
async function findGroup(package) {
    let base = '/home/cory/Documents/pkg/artixlinux/';
    let groups = ['addons', 'desktop', 'main'];
    for (let i = 0; i < groups.length; i++) {
        try {
            let trypath = path.join(base, groups[i], package);
            await fsp.readdir(trypath);
            return trypath;
        }
        catch {
        }
    }
    return null;
}

/**
 * Input gpg passphrase so pushing commits won't require it
 * @param {*} config the json config
 */
async function refreshGpg(config) {
    await runCommand('touch', ['signfile']);
    await runCommand('gpg', ['-a', '--passphrase', config.gpgpass, '--batch', '--pinentry-mode', 'loopback', '--detach-sign', 'signfile']);
    await fsp.rm('signfile.asc');
}

/**
 * increment pkgrel
 * @param {string} repo super repo
 * @param {*} package package to increment
 * @returns Promise<void>
 */
function increment(repo, package) {
    return new Promise(async (res, reject) => {
        let pkgbuild = path.join(repo, package, 'trunk', 'PKGBUILD');
        let lines = [];

        const rl = readline.createInterface({
            input: fs.createReadStream(pkgbuild),
            output: process.stdout,
            terminal: false
        });

        rl.on('line', async line => {
            if (line.startsWith('pkgrel')) {
                let pkgrel = line.split('=')[1].trim();
                // let's not deal with floats in javascript
                let num = pkgrel.split('.');
                if (num.length == 1) {
                    num.push(1);
                }
                else {
                    num[1] = parseInt(num[1]) + 1;
                }
                lines.push(`pkgrel=${num.join('.')}`);
            }
            else {
                lines.push(line);
            }
        });
        rl.on('close', async () => {
            await fsp.writeFile(pkgbuild, lines.join('\n') + '\n');
            res();
        });
    })
}

process.argv.forEach((arg, i) => {
    let iPlus = i + 1;
    let args = process.argv;
    if (arg === '--job' && iPlus < args.length) {
        JOB = args[iPlus];
    }
    else if (arg === '--start' && iPlus < args.length) {
        START = args[iPlus];
    }
});

if (JOB) {
    (async function () {
        let compare = null;
        let job = JSON5.parse(await fsp.readFile(JOB));
        job.source = job.source || 'trunk';
        job.gpgpass = process.env.GPGPASS || job.gpgpass || '';
        let verifyJenkins = job.source === 'trunk';
        let inc = job.increment;
        let pkg = job.pkg;
        let superrepo = job.repo || job.superrepo;
        if (!pkg) {
            console.error(clc.redBright('Must provide `pkg` command in config!'));
            process.exit(1);
        }
        if (inc && !superrepo) {
            console.error(clc.redBright('Must provide `repo` path in config if increment is enabled!'));
            process.exit(1);
        }

        console.log('artix-packy-pusher\nCory Sanin\n');

        if (job.source === 'trunk') {
            console.log(clc.yellowBright('Running comparepkg -u'));
            compare = new comparepkg();
            await compare.FetchUpgradable();
        }

        let jenkOptions = job.jenkins;
        let jUrl = jenkOptions.url || 'https://orion.artixlinux.org';
        const browser = verifyJenkins ? (await puppeteer.launch({ headless: true })) : null;
        const page = verifyJenkins ? (await browser.pages())[0] : null;
        if (verifyJenkins) {
            console.log(clc.yellowBright('Logging in to Jenkins'));
            await page.goto(`${jUrl}/login`);
            await page.waitForSelector(SELECTORS.login_username);
            await page.type(SELECTORS.login_username, jenkOptions.username);
            await page.type(SELECTORS.login_password, jenkOptions.password);
            await page.click(SELECTORS.login_button);
            await page.waitForSelector(SELECTORS.login_finish);
        }

        // order is IMPORTANT. Must be BLOCKING.
        for (let i = 0; i < (job.packages || []).length; i++) {
            let pFullName = job.packages[i]
            let p = pFullName.split('/');
            p = p[Math.min(1, p.length - 1)];
            if (START === p) {
                START = null;
            }
            if (START === null) {
                if (inc || compare === null || compare.IsUpgradable(p)) {
                    console.log((new Date()).toLocaleTimeString() + clc.magentaBright(` Package ${i}/${job.packages.length}`));
                    await refreshGpg(job);
                    console.log(clc.yellowBright(`Pushing ${p} ...`));
                    if (job.source == 'trunk') {
                        if (inc) {
                            await increment(superrepo, p);
                        }
                        else {
                            await runCommand('buildtree', ['-p', p, '-i']);
                            let ppath = await findGroup(p);
                            if (ppath){
                                await runCommand('sed', ['-i', '-e', 's/cmake\\( .*-B\\)/artix-cmake\\1/g', path.join(ppath, 'trunk', 'PKGBUILD')]);
                            }
                        }
                    }
                    await runCommand(pkg, ['-p', p, '-s', job.source]);
                    console.log(clc.blueBright(`${p} upgrade pushed`));
                    if (verifyJenkins) {
                        await page.goto(`${jUrl}/job/packages${p.charAt(0).toUpperCase()}/job/${p}/job/master/`);
                        try {
                            await waitForBuild(page);
                            console.log(clc.greenBright(`${p} built successfully.`));
                        }
                        catch (ex) {
                            console.error(clc.redBright(`Failed on ${p}:`));
                            console.error(ex);
                            process.exit(1);
                        }
                    }
                }
                else {
                    console.log(clc.magenta(`${p} isn't marked as upgradable. Skipping.`));
                }
            }
        }
        console.log(clc.greenBright('SUCCESS: All packages built'));
        if (verifyJenkins) {
            await browser.close();
        }
        process.exit(0);
    })();
}
else {
    console.error(clc.redBright('A job file must be provided.\n--job {path/to/job.json(5)}'));
}