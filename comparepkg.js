const spawn = require('child_process').spawn;
const clc = require('cli-color');

const TimeOut = 600000;
const ExtraSpace = new RegExp('\\s+', 'g');

class Comparepkg {
    upgradable = [];

    /**
     * runs comparepkg -u
     * @param {number} timeout max execution time
     * @returns {Promise}
     */
    FetchUpgradable(timeout = TimeOut) {
        return new Promise((resolve, reject) => {
            this.upgradable = [];
            let linestart = -1;
            let child = spawn('comparepkg', ['-u']);


            let to = setTimeout(() => {
                reject('Timed out');
                child.kill();
            }, timeout);

            child.stdout.setEncoding('utf8');
            child.stdout.on('data', data => {
                let line = data.toString();
                console.log(clc.blue(line));
                if (linestart === -1) {
                    linestart = line.indexOf('Arch Repo');
                }
                else {
                    line = line.substring(linestart).trim().replace(ExtraSpace, ' ').split(' ', 3);
                    if (line[0] !== 'Arch') {
                        this.upgradable.push(line[2]);
                    }
                }
            });

            child.on('exit', code => {
                clearTimeout(to);
                resolve(code);
            });
        });
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

module.exports = Comparepkg;