#!/bin/bash
# FINAL benchmark protocol: baseline and fast-path run in ADJACENT pairs
# (triplets where two fast variants share one adjacent baseline), so bursty
# load on this shared box hits both sides of each ratio roughly equally.
# Output: JSON lines tagged with a group + rep, consumed by final-summarize.js.
#
# Reproduce with:  bash final-bench.sh | tee final-bench.out
#                  node final-summarize.js final-bench.out
cd "$(dirname "$0")"
D=/tmp/claude-1000/-home-thiago-workspace-yajs/6f320fb9-93d1-4710-976d-a4516162334f/scratchpad
tag() { sed "s/^{/{\"group\":\"$1\",\"rep\":$2,/"; }

for rep in 1 2 3 4 5; do
  node bench-fast.js real    '$.field2.nested' "$D/data-1.ndjson" | tag ndjson-hot $rep
  node bench-fast.js chain   '$.field2.nested' "$D/data-1.ndjson" | tag ndjson-hot $rep
  node bench-hybrid.js       '$.field2.nested' "$D/data-1.ndjson" | tag ndjson-hot $rep
  uptime | sed 's/^/# /'
done
for rep in 1 2 3 4 5; do
  node bench-array.js real   '$.field2.nested' "$D/data-1-array.json" | tag array-hot $rep
  node bench-array.js achain '$.field2.nested' "$D/data-1-array.json" | tag array-hot $rep
  uptime | sed 's/^/# /'
done
for rep in 1 2 3; do
  node bench-fast.js real    '$..*' "$D/data-1.ndjson" | tag ndjson-descend $rep
  node bench-fast.js generic '$..*' "$D/data-1.ndjson" | tag ndjson-descend $rep
  uptime | sed 's/^/# /'
done
for rep in 1 2 3; do
  node bench-fast.js real    '$.field2.missing' "$D/data-1.ndjson" | tag ndjson-miss $rep
  node bench-fast.js chain   '$.field2.missing' "$D/data-1.ndjson" | tag ndjson-miss $rep
  node bench-hybrid.js       '$.field2.missing' "$D/data-1.ndjson" | tag ndjson-miss $rep
  uptime | sed 's/^/# /'
done
