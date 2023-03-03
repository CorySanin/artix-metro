const fs = require('fs');
const fsp = fs.promises;
const readline = require('readline');
const Writable = require('stream').Writable;
const path = require('path');
const spawn = require('child_process').spawn;
const clc = require('cli-color');
const JSON5 = require('json5');
const comparepkg = require('./comparepkg');
const giteaapi = require('./gitea');

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
 * @param {giteaapi} j 
 * @param {string} pkg 
 * @param {string} lastHash 
 */
async function waitForBuild(j, pkg, lastHash) {
    while (true) {
        let status;
        try {
            status = await j.getStatus(pkg);
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
                    throw `Build ${status.sha} failed. ${j.getHomepage()}${pkg}`;
                }
            }
            await snooze(5000);
        }
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
        job.gpgpass = process.env.GPGPASS || (await getGpgPass()) || '';
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

        const gitea = new giteaapi(job.gitea);
        if (job.source === 'trunk') {
            console.log(clc.yellowBright('Running comparepkg -u'));
            compare = new comparepkg();
            await compare.FetchUpgradable();
        }

        // order is IMPORTANT. Must be BLOCKING.
        for (let i = 0; i < (job.packages || []).length; i++) {
            let lastHash = '';
            let pFullName = job.packages[i]
            let p = pFullName.split('/');
            p = p[Math.min(1, p.length - 1)];
            if (START === p) {
                START = null;
            }
            if (START === null) {
                if (compare === null || compare.IsUpgradable(p)) {
                    console.log((new Date()).toLocaleTimeString() + clc.magentaBright(` Package ${i}/${job.packages.length}`));
                    if (verifyJenkins) {
                        lastHash = (await gitea.getStatus(pFullName)).sha
                        console.log(`current sha: ${lastHash}`);
                    }
                    await refreshGpg(job);
                    console.log(clc.yellowBright(`Pushing ${p} ...`));
                    if (job.source == 'trunk') {
                        if (inc) {
                            await increment(superrepo, p);
                        }
                        else {
                            await runCommand('btimport', [p]);
                        }
                    }
                    await runCommand(pkg, ['-p', p, '-s', job.source]);
                    console.log(clc.blueBright(`${p} upgrade pushed`));
                    if (verifyJenkins) {
                        try {
                            await waitForBuild(gitea, pFullName, lastHash);
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
        process.exit(0);
    })();
}
else {
    console.error(clc.redBright('A job file must be provided.\n--job {path/to/job.json(5)}'));
}