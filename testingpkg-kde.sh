#!/bin/bash
node index.js --job jobs/kde-01.json && \
buildtree -p spectacle -i; \
node rm-systemd.js --pkgbuild ~/Documents/pkg/artixlinux/kde-media/spectacle/trunk/PKGBUILD; \
testingpkg -p spectacle -u
node index.js --job jobs/kde-02.json && \
buildtree -p dolphin -i
node rm-systemd.js --pkgbuild ~/Documents/pkg/artixlinux/kde-utils/dolphin/trunk/PKGBUILD
testingpkg -p dolphin -u
node index.js --job jobs/kde-03.json
