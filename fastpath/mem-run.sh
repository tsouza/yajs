#!/bin/bash
# Max-RSS comparison: huge single record + normal dataset.
cd "$(dirname "$0")"
D=/tmp/claude-1000/-home-thiago-workspace-yajs/6f320fb9-93d1-4710-976d-a4516162334f/scratchpad
echo "== huge single 33MB record, tiny match =="
/usr/bin/time -v node bench-fast.js real '$.field2.nested' "$D/data-bigline.ndjson" 2>&1 | grep -E '^\{|Maximum resident'
/usr/bin/time -v node bench-fast.js chain '$.field2.nested' "$D/data-bigline.ndjson" 2>&1 | grep -E '^\{|Maximum resident'
/usr/bin/time -v node bench-hybrid.js '$.field2.nested' "$D/data-bigline.ndjson" 2>&1 | grep -E '^\{|Maximum resident'
echo "== 80MB small-records dataset =="
/usr/bin/time -v node bench-fast.js real '$.field2.nested' "$D/data-1.ndjson" 2>&1 | grep -E '^\{|Maximum resident'
/usr/bin/time -v node bench-fast.js chain '$.field2.nested' "$D/data-1.ndjson" 2>&1 | grep -E '^\{|Maximum resident'
/usr/bin/time -v node bench-hybrid.js '$.field2.nested' "$D/data-1.ndjson" 2>&1 | grep -E '^\{|Maximum resident'
/usr/bin/time -v node bench-array.js achain '$.field2.nested' "$D/data-1-array.json" 2>&1 | grep -E '^\{|Maximum resident'
