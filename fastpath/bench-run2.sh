#!/bin/bash
# match-nothing and match-everything selectors, interleaved, 3 reps.
cd "$(dirname "$0")"
DATA=/tmp/claude-1000/-home-thiago-workspace-yajs/6f320fb9-93d1-4710-976d-a4516162334f/scratchpad/data-1.ndjson
for rep in 1 2 3; do
  echo "--- rep $rep ---"
  node bench-fast.js real    '$.field2.missing' "$DATA"
  node bench-fast.js chain   '$.field2.missing' "$DATA"
  node bench-fast.js real    '$..*' "$DATA"
  node bench-fast.js generic '$..*' "$DATA"
  node bench-fast.js real    '$' "$DATA"
  node bench-fast.js chain   '$' "$DATA"
  uptime
done
