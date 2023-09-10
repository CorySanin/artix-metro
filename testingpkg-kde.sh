#!/bin/bash
node index.js --job jobs/kde-01.json5 && \
btimport spectacle && \
node rm-systemd.js --pkgbuild ~/Documents/pkg/artixlinux/spectacle/PKGBUILD &&
artixpkg repo add -p world-gremlins spectacle && \
node index.js --job jobs/kde-02.json5 && \
btimport dolphin && \
node rm-systemd.js --pkgbuild ~/Documents/pkg/artixlinux/dolphin/PKGBUILD && \
artixpkg repo add -p world-gremlins dolphin && \
node index.js --job jobs/kde-03.json5
curl --header "Content-Type: application/json" --request POST --data '{"packages": "batch done"}' 192.168.1.250:4444/artix
