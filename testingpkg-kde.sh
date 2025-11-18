#!/bin/bash
read -s -p "Enter your GPG password: " GPGPASS
export GPGPASS
artix-metro --job jobs/kde-add.jsonc \
&& artix-metro --job jobs/kde-move.jsonc

./notify.sh
GPGPASS=""
