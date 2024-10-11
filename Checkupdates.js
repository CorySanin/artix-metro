const spawn = require('child_process').spawn;
const clc = require('cli-color');

const TimeOut = 600000;
const ExtraSpace = new RegExp('\\s+', 'g');

class Checkupdates {
    upgradable = [];

    /**
     * runs comparepkg -u
     * @param {number} timeout max execution time
     * @returns {Promise}
     */
    FetchUpgradable(timeout = TimeOut) {
        return new Promise((resolve, reject) => {
            this.upgradable = [];
            let process = spawn('artix-checkupdates', ['-u']);
            let to = setTimeout(async () => {
                process.kill() && await cleanUpLockfiles();
                reject('Timed out');
            }, timeout);
            let outputstr = '';
            let errorOutput = '';
            process.stdout.on('data', data => {
                outputstr += data.toString();
            });
            process.stderr.on('data', err => {
                const errstr = err.toString();
                errorOutput += `${errstr}, `;
                console.error(errstr);
            })
            process.on('exit', async (code) => {
                clearTimeout(to);
                if (code !== 0 || errorOutput.length !== 0) {
                    errorOutput.includes('unable to lock database') && cleanUpLockfiles();
                    reject((code && `exited with ${code}`) || errorOutput);
                }
                else {
                    this.upgradable = this.parseCheckUpdatesOutput(outputstr);
                    this.upgradable.forEach(pkg => console.log(clc.blue(pkg)));
                    resolve(code);
                }
            });
        });
    }

    /**
     * parse output of checkupdates
     * @param {*} output output of artix-checkupdates
     * @returns an array of package names from the checkupdates output
     */
    parseCheckUpdatesOutput(output) {
        let packages = [];
        let lines = output.split('\n');
        lines.forEach(l => {
            let p = l.trim().replace(ExtraSpace, ' ');
            if (p.length > 0 && p.indexOf('Package basename') < 0) {
                packages.push(p.split(' ', 2)[0]);
            }
        });
        return packages;
    }

    /**
     * Whether a package has an upgrade or rebuild pending
     * @param {string} pkg the package name
     * @returns {boolean} if it's upgradable
     */
    IsUpgradable(pkg) {
        return this.upgradable.includes(pkg);
    }
}

module.exports = Checkupdates;