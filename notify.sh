#!/bin/bash
APPRISE_API="http://localhost:8000"
APPRISE_DESTINATION="tgram://TOKEN/CHAT_ID"

curl -d "{\"title\":\"artix-metro\", \"body\":\"Job done.\", \"urls\":\"${APPRISE_DESTINATION}\"}" -H "Content-Type: application/json" "${APPRISE_API}/notify/"