import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PathLike } from 'node:fs';

interface ArtoolsConf {
    workspace: string;
    giteaToken: string | null;
}

const DefaultConf: ArtoolsConf = {
    workspace: path.join(os.homedir(), 'artools-workspace'),
    giteaToken: null
}

function parseProperty(line: string): string {
    return (line.split('=')[1] || '').trim();
}

function removeQuotes(str: string) {
    if (
        (
            str.charAt(0) === '\'' ||
            str.charAt(0) === '"'
        ) && str.charAt(0) === str.charAt(str.length - 1)) {
        return str.substring(1, str.length - 1);
    }
    return str;
}

class ArtoolsConfReader {

    async readConf(): Promise<ArtoolsConf> {
        const primaryLocation = path.join(os.homedir(), '.config', 'artools', 'artools-pkg.conf');
        const systemConf = path.join('/', 'etc', 'artools', 'artools-pkg.conf');
        try {
            return await this.readConfFile(primaryLocation);
        }
        catch (ex) {
            console.error(`artools config at "${primaryLocation}" could not be read. ${ex}\nUsing system config "${systemConf}" instead.`);
            return await this.readConfFile(systemConf);
        }
    }

    async readConfFile(file: PathLike): Promise<ArtoolsConf> {
        const lines = (await fsp.readFile(file)).toString().split('\n');
        let workspace: string | null = null;
        let giteaToken: string | null = null;
        lines.forEach(l => {
            switch (true) {
                case l.startsWith('WORKSPACE_DIR='):
                    workspace = removeQuotes(parseProperty(l));
                    break;
                case l.startsWith('GIT_TOKEN='):
                    giteaToken = removeQuotes(parseProperty(l));
                    break;
            }
        });
        return {
            workspace: process.env['WORKSPACE'] || workspace || DefaultConf.workspace,
            giteaToken: process.env['GIT_TOKEN'] || giteaToken || null
        };
    }
}

export default ArtoolsConfReader;
export { ArtoolsConfReader, DefaultConf };
export type { ArtoolsConf }
