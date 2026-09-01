#!/bin/bash
# Top-level-array file benchmark, interleaved, 3 reps.
cd "$(dirname "$0")"
DATA=/tmp/claude-1000/-home-thiago-workspace-yajs/6f320fb9-93d1-4710-976d-a4516162334f/scratchpad/data-1-array.json
for rep in 1 2 3; do
  echo "--- rep $rep ---"
  node bench-array.js real   '$.field2.nested' "$DATA"
  node bench-array.js achain '$.field2.nested' "$DATA"
  node bench-array.js real   '$' "$DATA"
  node bench-array.js achain '$' "$DATA"
  node bench-array.js asplitonly x "$DATA"
  node bench-array.js aparseonly x "$DATA"
  uptime
done
