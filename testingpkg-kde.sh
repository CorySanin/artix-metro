#!/bin/bash
source ./password-prompt.sh
artix-metro --job jobs/kde-add.jsonc && \
artix-metro --job jobs/kde-move.jsonc

./notify.sh
GPGPASS=""
