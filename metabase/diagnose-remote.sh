#!/bin/bash
# Script to run diagnostics on Fly.io server where DATABASE_URL is available

export FLYCTL_INSTALL="/Users/rgareev91/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

echo "Uploading diagnostic script to server..."
flyctl ssh sftp shell -a abc-metrics << 'EOF'
put metabase/diagnose.js /tmp/diagnose.js
EOF

echo "Running diagnostics on server..."
flyctl ssh console -a abc-metrics << 'DIAGNOSTIC'
cd /tmp
node diagnose.js
DIAGNOSTIC





