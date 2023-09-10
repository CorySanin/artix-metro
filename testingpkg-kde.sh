#!/bin/bash
node index.js --job jobs/kde-01.json5 && \
node index.js --job jobs/kde-02-push.json
curl --header "Content-Type: application/json" --request POST --data '{"packages": "batch done"}' 192.168.1.250:4444/artix
