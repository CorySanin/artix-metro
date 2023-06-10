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
            let linestart = 0;
            let child = spawn('artix-checkupdates', ['-u']);


            let to = setTimeout(() => {
                reject('Timed out');
                child.kill();
            }, timeout);

            child.stdout.setEncoding('utf8');
            child.stdout.on('data', data => {
                let lines = data.toString().split('\n');
                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    if (linestart === -1) {
                        linestart = line.indexOf('Package basename');
                    }
                    else {
                        line = this.ParseLine(line, linestart);
                        if (line[0] !== 'Package' && line[0].length > 0) {
                            this.upgradable.push(line[0]);
                        }
                    }
                }
            });

            child.on('exit', code => {
                this.upgradable.forEach(pkg => console.log(clc.blue(pkg)));
                clearTimeout(to);
                resolve(code);
            });
        });
    }

    /**
     * Returns the first element from the line of a table
     * @param {*} str The line to parse
     * @param {*} linestart the amount of indentation
     * @returns 
     */
    ParseLine(str, linestart = 0) {
        return str.substring(linestart).trim().replace(ExtraSpace, ' ').split(' ');
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