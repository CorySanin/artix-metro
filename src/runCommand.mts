import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

/**
 * Run a command (as a promise).
 * @param command command to run
 * @param args args to pass
 * @returns promise that yields true if success
 */
function runCommand(command: string, args: string[] = [], stdOutToLogs: boolean = true): Promise<boolean> {
    return new Promise((res, _) => {
        const opts: SpawnOptions = {stdio: stdOutToLogs ? ['pipe', 'inherit', 'inherit'] : 'pipe'};
        const proc = spawn(command, args, opts);
        proc.on('exit', code => res(code === 0));
    });
}

/**
 * Check if password input is necessary for signing
 * @returns promise that yieds true if password is required
 */
function isPasswordRequired(): Promise<boolean> {
    return new Promise(async (res, _) => {
        if (! await runCommand('gpg-agent', [], false)) {
            return res(true);
        }
        const proc = spawn('gpg-connect-agent', ['KEYINFO --list', '/bye'], { stdio: 'pipe' });
        let outputstr = '';
        proc.stdout.on('data', data => {
            outputstr += data.toString();
        });
        proc.on('exit', async () => {
            const keyinfo = outputstr.split('\n').filter(l => l.includes('KEYINFO'));
            res(!keyinfo.find(l => {
                const tokens = l.split(' ');
                return tokens[0] === 'S' && tokens[1] === 'KEYINFO' && tokens[3] === 'D' && tokens[6] === '1';
            }));
        });
    });
}

export default runCommand;
export { runCommand, isPasswordRequired };
