import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import clc from 'cli-color';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Checkupdates } from 'artix-checkupdates';
import { Gitea } from './gitea.mjs'
import { ArtoolsConfReader, DefaultConf } from './artoolsconf.mjs';
import { snooze } from './snooze.mjs';
import type { ArtixRepo } from 'artix-checkupdates';
import type { ArtoolsConf } from './artoolsconf.mts';

interface PusherConfig {
    gpgpass?: string;
}

type ArtixpkgRepo = ArtixRepo | 'stable' | 'gremlins' | 'goblins';

interface Job extends Partial<ArtoolsConf> {
    source?: ArtixpkgRepo;
    repo: ArtixpkgRepo;
    increment: boolean;
    packages: string[];
}

const PACKAGE_ORG = 'packages';
const SIGNATUREEXPIRY = 30000;//in ms
const SIGNFILE = path.join(os.tmpdir(), 'signfile');

/**
 * Run a command (as a promise).
 * @param command command to run
 * @param args args to pass
 * @returns true if success
 */
function runCommand(command: string, args: string[] = []): Promise<boolean> {
    return new Promise((res, _) => {
        let proc = spawn(command, args, { stdio: ['ignore', process.stdout, process.stderr] });
        proc.on('exit', code => res(code === 0));
    });
}

/**
 * Formats text to be sent as a parameter to some command
 * @param param 
 */
function escapeCommandParam(param: string) {
    return param.replace(/\\/g, "\\\\");
}



class Pusher {
    private _gitea: Gitea | null;
    private _lastSign: number = 0;
    private _config: PusherConfig;
    private _artools: ArtoolsConf;
    private _constructed: Promise<void>;

    constructor(config: PusherConfig = {}) {
        this._gitea = null;
        this._artools = DefaultConf
        this._config = config;
        this._constructed = (async () => {
            try {
                this._artools = await (new ArtoolsConfReader()).readConf();
                this._gitea = new Gitea({
                    token: this._artools.giteaToken || ''
                });
            }
            catch (ex) {
                this._artools = DefaultConf
                console.error(ex);
            }
        })();
    }

    async refreshGpg() {
        let currentTime = (new Date()).getTime();
        if (this._config.gpgpass && currentTime - this._lastSign > SIGNATUREEXPIRY) {
            console.log(clc.cyan('Refreshing signature...'));
            await runCommand('touch', [SIGNFILE]);
            await runCommand('gpg', ['-a', '--passphrase', escapeCommandParam(this._config.gpgpass), '--batch', '--pinentry-mode', 'loopback', '--detach-sign', SIGNFILE]);
            await fsp.rm(`${SIGNFILE}.asc`);
            this._lastSign = currentTime;
        }
    }

    increment(pkg: string): Promise<void> {
        return new Promise(async (res, _) => {
            const pkgbuild = path.join(this._artools.workspace, 'artixlinux', pkg, 'PKGBUILD');
            let lines: string[] = [];

            const rl = readline.createInterface({
                input: fs.createReadStream(pkgbuild),
                output: process.stdout,
                terminal: false
            });

            rl.on('line', async line => {
                if (line.trim().startsWith('pkgrel')) {
                    const pkgrelLine = line.split('=');
                    if (pkgrelLine.length <= 1) {
                        throw new Error(`Failed to parse pkgrel line: \n${line}`);
                    }
                    const pkgrel = (pkgrelLine[1] as string).trim();
                    // let's not deal with floats in javascript
                    let num = pkgrel.split('.');
                    if (num.length > 1) {
                        num[1] = `${parseInt(num[1] as string) + 1}`;
                    }
                    else {
                        num.push('1');
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

    async isNewPackage(pkg: string) {
        const pkgbuild = path.join(this._artools.workspace, 'artixlinux', pkg, 'PKGBUILD');
        try {
            const stat = await fsp.stat(pkgbuild);
            return !stat.size;
        }
        catch {
            console.log('PKGBUILD doesn\'t exist. Assuming package is new.');
            console.info(`checked ${pkgbuild}`);
            return true;
        }
    }

    async runJob(job: Job) {
        await this._constructed;
        const checkupdates = new Checkupdates();
        const gitea = this._gitea as Gitea;

        this._artools.workspace = job.workspace || this._artools.workspace;
        gitea.setToken(job.giteaToken);

        if (!job.repo) {
            throw new Error('Must provide `repo` destination in config!');
        }
        if (job.increment && !this._artools?.workspace) {
            throw new Error('Must provide `directory` path in config if increment is enabled!');
        }
        if (job.increment && job.source) {
            throw new Error('increment can\'t be set to true for a move operation. Set increment to false or remove the source repo.');
        }

        console.log(clc.yellowBright('Running artix-checkupdates'));
        const actionable = job.increment ? job.packages : (await (!!job.source ? checkupdates.fetchMovable() : checkupdates.fetchUpgradable())).map(res => res.basename);

        // order is IMPORTANT. Must be BLOCKING.
        for (let i = 0; i < (job.packages || []).length; i++) {
            const p: string = job.packages[i] as string;
            let lastHash: string = '';
            if (!job.increment && !actionable.includes(p) && ! await this.isNewPackage(p)) {
                console.log(clc.magenta(`${p} isn't marked as upgradable. Skipping.`));
                continue;
            }
            console.log((new Date()).toLocaleTimeString() + clc.magentaBright(` Package ${i}/${job.packages.length}`));
            while (!job.source) {
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
            if (job.source) {
                try {
                    await this.refreshGpg();
                    await runCommand('artixpkg', ['repo', 'move', '-p', job.source, job.repo, p]);
                }
                catch {
                    console.log(clc.cyan(`Moving ${p} failed.`));
                }
            }
            else {
                if (job.increment) {
                    await this.increment(p);
                }
                else {
                    await runCommand('artixpkg', ['repo', 'import', p]);
                }
                await this.refreshGpg();
                await runCommand('artixpkg', ['repo', 'add', '-p', job.repo, p]);
            }
            console.log(clc.blueBright(`${p} commit pushed`));
            if (!job.source) {
                try {
                    await gitea.waitForBuild(lastHash, PACKAGE_ORG, p)
                    console.log(clc.greenBright(`${p} built successfully.`));
                }
                catch (ex) {
                    console.error(clc.redBright(`Failed on ${p} : ${gitea.getHomepage()}${PACKAGE_ORG}/${p}`));
                    throw ex;
                }
            }
        }
        console.log(clc.greenBright('SUCCESS: All packages built'));
        try {
            await fsp.rm(SIGNFILE);
        }
        catch {
            console.error(clc.red('failed to remove temp signfile'));
        }
    }
}

export default Pusher;
export { Pusher };
export type { PusherConfig, Job, ArtixpkgRepo };
