const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const spawn = require('child_process').spawn;
const clc = require('cli-color');
const JSON5 = require('json5');
const puppeteer = require('puppeteer');

const SELECTORS = {
    login_username: '#j_username',
    login_password: 'input[name=j_password]',
    login_button: '.submit input',
    login_finish: '.breadcrumbBarAnchor',
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
 * Input gpg passphrase so pushing commits won't require it
 * @param {*} config the json config
 */
async function refreshGpg(config) {
    await runCommand('touch', ['signfile']);
    await runCommand('gpg', ['-a', '--passphrase', config.gpgpass, '--batch', '--pinentry-mode', 'loopback', '--detach-sign', 'signfile']);
    await fsp.rm('signfile.asc');
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
        let job = JSON5.parse(await fsp.readFile(JOB));
        job.source = job.source || 'trunk';
        job.gpgpass = process.env.GPGPASS || job.gpgpass || '';
        let pkg = job.pkg;
        if (!pkg) {
            console.error(clc.redBright('Must provide `pkg` command in config!'));
            process.exit(1);
        }

        console.log('artix-packy-pusher\nCory Sanin\n');

        let jenkOptions = job.jenkins;
        let jUrl = jenkOptions.url || 'https://orion.artixlinux.org';
        const browser = await puppeteer.launch({ headless: true });
        const page = (await browser.pages())[0];
        console.log(clc.yellowBright('Logging in to Jenkins'));
        await page.goto(`${jUrl}/login`);
        await page.waitForSelector(SELECTORS.login_username);
        await page.type(SELECTORS.login_username, jenkOptions.username);
        await page.type(SELECTORS.login_password, jenkOptions.password);
        await page.click(SELECTORS.login_button);
        await page.waitForSelector(SELECTORS.login_finish);

        // order is IMPORTANT. Must be BLOCKING.
        for (let i = 0; i < (job.packages || []).length; i++) {
            let p = job.packages[i];
            if (START === p) {
                START = null
            }
            if (START === null) {
                console.log((new Date()).toLocaleTimeString() + clc.magentaBright(` Package ${i}/${job.packages.length}`));
                await refreshGpg(job);
                console.log(clc.yellowBright(`Pushing ${p}...`));
                if (job.source == 'trunk') {
                    await runCommand('buildtree', ['-p', p, '-i']);
                }
                await runCommand(pkg, ['-p', p, '-s', job.source, '-u']);
                console.log(clc.blueBright('Upgrade pushed'));
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
        console.log(clc.greenBright('SUCCESS: All packages built'));
        browser.close();
    })()
}
else {
    console.error(clc.redBright('A job file must be provided.\n--job {path/to/job.json(5)}'));
}