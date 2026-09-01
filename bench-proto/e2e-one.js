'use strict';
// Usage: node e2e-one.js <base|proto> <file>
// Mirrors e2e.js (createReadStream -> yajs('$.field2.nested') -> count)
// but selects dist vs dist-baseline and reports wall + process CPU ms.
const { createReadStream } = require('fs');
const which = process.argv[2];
const yajs = require(which === 'base' ? '../dist-baseline/main/main.js' : '../dist/main/main.js');

const file = process.argv[3];
let count = 0;
const t0 = process.hrtime.bigint();
const c0 = process.cpuUsage();
createReadStream(file).pipe(yajs('$.field2.nested')).
    on('data', () => count++).
    on('error', (err) => { console.error(err.stack); process.exit(1); }).
    on('end', () => {
        const wall = Number(process.hrtime.bigint() - t0) / 1e6;
        const cu = process.cpuUsage(c0);
        console.log(JSON.stringify({ which, count, wallMs: +wall.toFixed(0), cpuMs: +((cu.user + cu.system) / 1e3).toFixed(0) }));
    });
