import { spawn, type SpawnPromiseOptions } from 'spawn-but-with-promises';

/**
 * Run a command (as a promise).
 * @param command command to run
 * @param args args to pass
 * @returns promise that yields true if success
 */
export async function runCommand(command: string, args: string[] = [], stdOutToLogs: boolean = true): Promise<boolean> {
    const opts: SpawnPromiseOptions = { stdio: stdOutToLogs ? ['pipe', 'inherit', 'inherit'] : 'pipe', rejectOnNonZero: true };
    return await spawn(command, args, opts) === 0;
}

/**
 * Check if password input is necessary for signing
 * @returns promise that yieds true if password is required
 */
export async function isPasswordRequired(): Promise<boolean> {
    if (! await runCommand('gpg-agent', [], false)) {
        return true;
    }
    const proc = spawn('gpg-connect-agent', ['KEYINFO --list', '/bye'], { stdio: 'pipe' });
    let outputstr = '';
    proc.stdout.on('data', data => {
        outputstr += data.toString();
    });
    await proc;
    const keyinfo = outputstr.split('\n').filter(l => l.includes('KEYINFO'));
    return !keyinfo.find(l => {
        const tokens = l.split(' ');
        return tokens[0] === 'S' && tokens[1] === 'KEYINFO' && tokens[3] === 'D' && tokens[6] === '1';
    });
}

export default runCommand;
