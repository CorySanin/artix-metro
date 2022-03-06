const { rejects } = require('assert');
const fs = require('fs');
const readline = require('readline');
const fsp = fs.promises;

let pkgtemp, pkgbuild = process.env.PKGBUILD || '';

process.argv.forEach((arg, i) => {
    let iPlus = i + 1;
    if (arg === '--pkgbuild' && iPlus < process.argv.length) {
        pkgbuild = process.argv[iPlus];
    }
});
pkgtemp = `${pkgbuild}.temp`;

/**
 * Write one line, I promise ;)
 * @param {fs.WriteStream} stream 
 * @param {string} line 
 * @returns Promise<void>
 */
function writeLine(stream, line){
    return new Promise((res, reject) => {
        stream.write(`${line}\n`, err => {
            if(err){
                reject(err);
            }
            else{
                res();
            }
        })
    });
}

new Promise(async (res, reject) => {
    let packageBlock = false;

    await fsp.rename(pkgbuild, pkgtemp);
    let wstream = fs.createWriteStream(pkgbuild);

    const rl = readline.createInterface({
        input: fs.createReadStream(pkgtemp),
        output: process.stdout,
        terminal: false
    });

    rl.on('line', async line => {
        if (packageBlock && line.includes('}')) {
            packageBlock = false;
            await writeLine(wstream, '  rm -r $pkgdir/usr/lib/systemd');
        }
        packageBlock = packageBlock || line.includes('package()');
        await writeLine(wstream, line);
    });
    rl.on('close', async() => {
        await fsp.rm(pkgtemp);
        res();
    });
});