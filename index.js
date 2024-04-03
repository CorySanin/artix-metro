const fs = require('fs');
const fsp = fs.promises;
const readline = require('readline');
const Writable = require('stream').Writable;
const path = require('path');
const spawn = require('child_process').spawn;
const clc = require('cli-color');
const JSON5 = require('json5');
const checkupdates = require('./Checkupdates');
const giteaapi = require('./gitea');

const PACKAGE_ORG = 'packages';
const SIGNATUREEXPIRY = 30000;//in ms

let JOB = process.env.JOB;
let START = null;
let LASTSIGNTIME = new Date(0);

/**
 * Sleep equivalent as a promise
 * @param {number} ms Number of ms
 * @returns Promise<void>
 */
const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for a new build to succeed
 * @param {giteaapi} tea 
 * @param {string} pkg 
 * @param {string} lastHash 
 */
async function waitForBuild(tea, pkg, lastHash) {
    while (true) {
        let status;
        try {
            status = await tea.getStatus(PACKAGE_ORG, pkg);
        }
        catch {
            status = null;
            await snooze(30000);
        }
        if (status) {
            if (status.sha !== lastHash) {
                if (status.state === 'success') {
                    break;
                }
                else if (status.state === 'failure') {
                    throw `Build ${status.sha} failed. ${tea.getHomepage()}${PACKAGE_ORG}/${pkg}`;
                }
            }
            await snooze(5000);
        }
    }
}

/**
 * Run a command (as a promise).
 * @param {string} command 
 * @param {string[]} args 
 * @returns Promise<number>
 */
function runCommand(command, args = []) {
    return new Promise((res, reject) => {
        let proc = spawn(command, args, { stdio: ['ignore', process.stdout, process.stderr] });
        proc.on('exit', code => {
            if (code === 0) {
                res();
            }
            else {
                reject(code);
            }
        });
    });
}

/**
 * Prompts the user to input their GPG password via stdin
 * @returns a promise that resolves the password
 */
function getGpgPass() {
    return new Promise(resolve => {
        let mutableStdout = new Writable({
            write: function (chunk, encoding, callback) {
                if (!this.muted) {
                    process.stdout.write(chunk, encoding);
                }
                callback();
            }
        });
        let rl = readline.createInterface({
            input: process.stdin,
            output: mutableStdout,
            terminal: true
        });
        mutableStdout.muted = false;
        rl.question(clc.yellow('Enter your GPG password: '), (password) => {
            rl.close();
            console.log();
            resolve(password);
        });
        mutableStdout.muted = true;
    });
}

/**
 * Input gpg passphrase so pushing commits won't require it
 * @param {*} config the json config
 */
async function refreshGpg(config) {
    let currentTime = new Date();
    if (currentTime.getTime() - LASTSIGNTIME.getTime() > SIGNATUREEXPIRY) {
        console.log(clc.cyan('Refreshing signature...'));
        await runCommand('touch', ['signfile']);
        await runCommand('gpg', ['-a', '--passphrase', escapeCommandParam(config.gpgpass), '--batch', '--pinentry-mode', 'loopback', '--detach-sign', 'signfile']);
        await fsp.rm('signfile.asc');
        LASTSIGNTIME = currentTime;
    }
}

/**
 * Formats text to be sent as a parameter to some command
 * @param {string} param 
 */
function escapeCommandParam(param) {
    return param.replace(/\\/g, "\\\\");
}

/**
 * increment pkgrel
 * @param {string} directory location of all package git repos
 * @param {*} package package to increment
 * @returns Promise<void>
 */
function increment(directory, package) {
    return new Promise(async (res, reject) => {
        const pkgbuild = path.join(directory, package, 'PKGBUILD');
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

async function isNewPackage(directory, package) {
    if (!directory) {
        return false;
    }

    try {
        const pkgbuild = path.join(directory, package, 'PKGBUILD');
        const stat = await fsp.stat(pkgbuild);
        return !stat.size;
    }
    catch {
        console.log('PKGBUILD doesn\'t exist. Assuming package is new.');
        return true;
    }
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
        job.gpgpass = process.env.GPGPASS || (await getGpgPass()) || '';
        let verifyJenkins = job.source === 'trunk';
        let inc = job.increment;
        let repo = job.repo;
        let directory = job.directory || job.superrepo;
        if (!repo) {
            console.error(clc.redBright('Must provide `repo` destination in config!'));
            process.exit(1);
        }
        if (inc && !directory) {
            console.error(clc.redBright('Must provide `directory` path in config if increment is enabled!'));
            process.exit(1);
        }

        console.log('artix-packy-pusher\nCory Sanin\n');

        const gitea = new giteaapi(job.gitea);
        if (job.source === 'trunk') {
            console.log(clc.yellowBright('Running artix-checkupdates'));
            compare = new checkupdates();
            await compare.FetchUpgradable();
        }

        // order is IMPORTANT. Must be BLOCKING.
        for (let i = 0; i < (job.packages || []).length; i++) {
            let lastHash = '';
            let p = job.packages[i];
            if (START === p) {
                START = null;
            }
            if (START === null) {
                if (compare === null || compare.IsUpgradable(p) || await isNewPackage(directory, p)) {
                    console.log((new Date()).toLocaleTimeString() + clc.magentaBright(` Package ${i}/${job.packages.length}`));
                    while (verifyJenkins) {
                        try {
                            lastHash = (await gitea.getStatus(PACKAGE_ORG, p)).sha
                            console.log(`current sha: ${lastHash}`);
                            break;
                        }
                        catch {
                            console.log(clc.red(`Failed to get status of ${p}. Retrying...`));
                            await snooze(30000);
                        }
                    }
                    console.log(clc.yellowBright(`Pushing ${p} ...`));
                    if (job.source == 'trunk') {
                        if (inc) {
                            await increment(directory, p);
                        }
                        else {
                            await runCommand('artixpkg', ['repo', 'import', p]);
                        }
                        await refreshGpg(job);
                        await runCommand('artixpkg', ['repo', 'add', '-p', repo, p]);
                    }
                    else {
                        try {
                            await refreshGpg(job);
                            await runCommand('artixpkg', ['repo', 'move', '-p', job.source, repo, p]);
                        }
                        catch {
                            console.log(clc.cyan(`Moving ${p} failed. Maybe nothing to move. Continuing.`));
                        }
                    }
                    console.log(clc.blueBright(`${p} upgrade pushed`));
                    if (verifyJenkins) {
                        try {
                            await waitForBuild(gitea, p, lastHash);
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
        try {
            await fsp.rm('signfile');
        }
        catch {
            console.error(clc.red('failed to remove temp signfile'));
        }
        process.exit(0);
    })();
}
else {
    console.error(clc.redBright('A job file must be provided.\n--job {path/to/job.json(5)}'));
}