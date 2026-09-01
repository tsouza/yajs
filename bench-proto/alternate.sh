#!/bin/sh
cd "$(dirname "$0")"
D=/tmp/claude-1000/-home-thiago-workspace-yajs/6f320fb9-93d1-4710-976d-a4516162334f/scratchpad/data-1.ndjson
for r in 1 2 3; do
  node tok-one.js base "$D" 4
  node tok-one.js proto "$D" 4
done
uptime
