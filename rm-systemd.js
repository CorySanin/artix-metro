#!/usr/bin/node
const fs = require('fs');
const readline = require('readline');
const fsp = fs.promises;

/**
 * A primitive way to automate removing systemd junk.
 * Was written specifically for the two KDE packages that need this treatment.
 * As a result, this probably won't handle edge cases as-is.
 */

let pkgtemp, pkgbuild = process.env.PKGBUILD || '/home/cory/Documents/pkg/artixlinux/thunar/trunk/PKGBUILD';

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
    let lines = [];

    await fsp.rename(pkgbuild, pkgtemp);
    let wstream = fs.createWriteStream(pkgbuild);

    const rl = readline.createInterface({
        input: fs.createReadStream(pkgtemp),
        output: process.stdout,
        terminal: false
    });

    rl.on('line', line => lines.push(line));

    rl.on('close', async() => {
        for(let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (packageBlock && line.startsWith('}')) {
                packageBlock = false;
                await writeLine(wstream, '  rm -r $pkgdir/usr/lib/systemd');
            }
            await writeLine(wstream, line);
            packageBlock = packageBlock || line.includes('package()');
        }

        await fsp.rm(pkgtemp);
        res();
    });
});