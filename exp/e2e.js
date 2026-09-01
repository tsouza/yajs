// End-to-end dataset-1 workload harness (mirrors src/bench/bench-yajs.ts).
// Usage: node e2e.js <file> [--gunzip]
'use strict';
const { createReadStream } = require('fs');
const { createGunzip } = require('zlib');
const yajs = require('../dist/main/main.js');

const file = process.argv[2];
const gz = process.argv.includes('--gunzip');

let stream = createReadStream(file);
if (gz) { stream = stream.pipe(createGunzip()); }

let count = 0;
const start = process.hrtime.bigint();
stream.pipe(yajs('$.field2.nested')).
    on('data', () => count++).
    on('error', (err) => { console.error(err.stack); process.exit(1); }).
    on('end', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        console.log(JSON.stringify({ count, ms: +ms.toFixed(1) }));
    });
