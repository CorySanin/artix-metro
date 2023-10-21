#!/bin/bash
read -s -p "Enter your GPG password: " GPGPASS
export GPGPASS
node index.js --job jobs/kde-01.json5 \
&& node index.js --job jobs/kde-02-push.json

./notify.sh
GPGPASS=""
