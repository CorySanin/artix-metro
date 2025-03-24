import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import clc from 'cli-color';
import path from 'node:path';
import os from 'node:os';
import { Checkupdates } from 'artix-checkupdates';
import { Gitea } from './gitea.mjs'
import { DefaultConf } from './artoolsconf.mjs';
import { snooze } from './snooze.mjs';
import { runCommand, isPasswordRequired } from './runCommand.mjs';
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
const SIGNFILE = path.join(os.tmpdir(), 'signfile');

/**
 * Formats text to be sent as a parameter to some command
 * @param param 
 */
function escapeCommandParam(param: string) {
    return param.replace(/\\/g, "\\\\");
}



class Pusher {
    private _gitea: Gitea | null;
    private _config: PusherConfig;
    private _artools: ArtoolsConf;
    private _createdSignfile: boolean;

    constructor(config: PusherConfig = {}, artoolsConf: ArtoolsConf = DefaultConf) {
        this._gitea = null;
        this._artools = artoolsConf;
        this._config = config;
        this._createdSignfile = false;
        this._gitea = new Gitea({
            token: this._artools.giteaToken || ''
        });
    }

    async refreshGpg() {
        if (await isPasswordRequired()) {
            console.log(clc.cyan('Refreshing signature...'));
            this._createdSignfile ||= await runCommand('touch', [SIGNFILE]);
            if ('SSHKEYSIGN' in process.env) 
            {
               await runCommand('ssh-keygen', [ '-Y',  'sign', '-f', path.resolve(process.env['SSHKEYSIGN'] as string), '-n', ' git', SIGNFILE]);
	        }
	        else
		        {
            	    await runCommand('gpg', ['-a', '--passphrase', escapeCommandParam(this._config.gpgpass || ''), '--batch', '--pinentry-mode', 'loopback', '--detach-sign', SIGNFILE]);
		        }
	    	if ('SSHKEYSIGN' in process.env) 
		        {
			        await fsp.rm(`${SIGNFILE}.sig`)
	    	    }
	    	else
		        {
            	    await fsp.rm(`${SIGNFILE}.asc`)
		        }
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
        const actionable = job.increment ? job.packages : (await (!!job.source ? checkupdates.fetchLooseMovable() : checkupdates.fetchUpgradable())).map(res => res.basename);

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
        if (this._createdSignfile) {
            try {
                await fsp.rm(SIGNFILE);
            }
            catch {
                console.error(clc.red('failed to remove temp signfile'));
            }
        }
    }
}

export default Pusher;
export { Pusher };
export type { PusherConfig, Job, ArtixpkgRepo };
