import * as fsp from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import clc from 'cli-color';
import JSON5 from 'json5';
import { Writable } from 'stream';
import { Pusher } from './pusher.mjs';
import type { Job, ArtixpkgRepo } from './pusher.mts';

/**
 * Prompts the user to input their GPG password via stdin
 * @returns a promise that resolves the password
 */
async function getGpgPass() {
    let muted = false;
    let mutableStdout = new Writable({
        write: function (chunk, encoding, callback) {
            if (!muted) {
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
    const passwordPromise = rl.question(clc.yellow('Enter your GPG password: '));
    muted = true;
    const password = await passwordPromise;
    rl.close();
    console.log();
    muted = false;
    return password;
}

async function artixMetro() {
    let job: Partial<Job> = {
        increment: false,
        packages: []
    };

    await (async function () {
        let mode: 'add' | 'move' | null = null;
        let startPkg: string | null = null;
        let jobfile: string | null = null;
        let skipOne = false;
        let helpFlag: boolean = false;

        process.argv.forEach((arg, i) => {
            if (skipOne) {
                skipOne = false;
                return;
            }
            const iPlus = i + 1;
            const args = process.argv;
            switch (true) {
                case (arg === '--job' || arg === '-j') && iPlus < args.length:
                    if (jobfile) {
                        console.error(`multiple jobfiles provided. aborting.`);
                        process.exit(2);
                    }
                    jobfile = args[iPlus] as string;
                    skipOne = true;
                    break;
                case arg === '--start' && iPlus < args.length:
                    startPkg = args[iPlus] as string;
                    skipOne = true;
                    break;
                case arg === '--token' && iPlus < args.length:
                    job.giteaToken = args[iPlus] as string;
                    skipOne = true;
                    break;
                case arg === '--workspace' && iPlus < args.length:
                    job.workspace = args[iPlus] as string;
                    skipOne = true;
                    break;
                case arg === '--increment':
                    job.increment = true;
                    break;
                case arg === '-p':
                    console.warn('-p option is implied.');
                    break;
                case arg === '-h' || arg === '--help':
                    helpFlag = true;
                    break;
                case arg.startsWith('-'):
                    console.error(`unrecognized option '${arg}'`);
                    process.exit(1);
                case !mode && (arg === 'add' || arg === 'move'):
                    mode = arg;
                    break;
                case mode === 'move' && !(job as Job).source:
                    job.source = arg as ArtixpkgRepo;
                    break;
                case mode && !job.repo:
                    job.repo = arg as ArtixpkgRepo;
                    break;
                case !!job.repo:
                    job.packages?.push(arg);
                    break;
            }
        });

        if (helpFlag || (!jobfile && !job.repo)) {
            console.log([
                `\nUsage: artix-metro [OPTIONS] [commands]...`,
                'works similarly to "artixpkg repo"... but with a few tricks!',
                'All package operations check if the package appears in the appropriate artix-checkupdate output.',
                'Build operations don\'t proceed until the previous build succeeds. Halts on failed build.\n',
                'Options',
                '-j, --job <jobfile>\tread instructions from a job file. Overrides all other options except --start',
                '--start <package>\tskips all packages before the provided package',
                '--token <token>\t\tdefines the Gitea token to use for making calls to the Gitea API',
                '--workspace <path>\tdefines the artools workspace',
                '--increment\t\tenable increment mode',
                '-h, --help\t\tshows this help message\n',
                'Commands',
                'add <destination> <pkgbase>...\t\t\tupgrade and push all packages to the specified destination',
                'move <source> <destination> <pkgbase>...\tmove all packages from the source repo to the destination repo\n',
            ].join('\n'));
            process.exit(0);
        }

        if (jobfile) {
            try {
                job = JSON5.parse((await fsp.readFile(jobfile)).toString());
            }
            catch (ex) {
                console.error('A jobfile was provided but could not be read:');
                console.error(ex);
                process.exit(4);
            }
        }

        if (startPkg && job.packages) {
            const startPos = job.packages.indexOf(startPkg);
            job.packages.splice(0, startPos < 0 ? job.packages.length : startPos)
        }
    })();

    let pusher = new Pusher({
        gpgpass: process.env['GPGPASS'] || (await getGpgPass()) || ''
    });

    try {
        await pusher.runJob(job as Job);
    }
    catch (ex) {
        console.error(clc.red('job threw exception:'));
        console.error(ex);
        process.exit(5)
    }
}

export default artixMetro;
export { artixMetro };
