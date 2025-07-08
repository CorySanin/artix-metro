#!/bin/bash
read -s -p "Enter your GPG password: " GPGPASS
export GPGPASS
artix-metro --job jobs/kde-add.json5 \
&& artix-metro --job jobs/kde-move.json5

./notify.sh
GPGPASS=""
