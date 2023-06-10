# artix-packy-pusher

Given a list of packages, build one at a time. Exits if a build fails.

## Setup

This program makes use of my [btimport](btimport.pl) script. Update the $pkgpath variable and install (perhaps with a symlink) the script as btimport.

This script first performs a `artixpkg repo import`. Then it tries to add your makepkg.conf PACKAGER info as a maintainer at the top of the PKGBUILD.
Finally it replaces cmake with artix-cmake, ONLY IF the package previously used artix-cmake.

`artix-checkupdates` is also required. I highly recommend configuring it to use the developer artix repo.
It uses `artix-checkupdates` to retrieve a list of packages that actually do have updates pending. packy-pusher will skip packages that don't need to be updated.

## Config

Please see [example.json5](jobs/example.json5). Program can parse json5 or plain json.

## Use
In order to sign commits, packy-pusher needs your GPG password. It can either be provided via the `GPGPASS` environment variable.
Otherwise the program will prompt you for it on startup.

Run a job:
```
node index.js --job jobs/example.json5
```
Run a job, skipping to a particular package:
```
node index.js --job jobs/example.json5 --start kmail
```