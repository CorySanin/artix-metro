#!/bin/bash
node index.js --job jobs/kde-01.json && \
btimport spectacle && \
node rm-systemd.js --pkgbuild ~/Documents/pkg/artixlinux/desktop/spectacle/trunk/PKGBUILD &&
testingpkg -p spectacle && \
node index.js --job jobs/kde-02.json && \
btimport dolphin && \
node rm-systemd.js --pkgbuild ~/Documents/pkg/artixlinux/desktop/dolphin/trunk/PKGBUILD && \
testingpkg -p dolphin && \
node index.js --job jobs/kde-03.json;
curl --header "Content-Type: application/json" --request POST --data '{"packages": "batch done"}' 192.168.1.250:4444/artix
