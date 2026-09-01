// Paired end-to-end benchmark: full yajs() pipeline (createReadStream ->
// through stream -> data events), base vs final ALTERNATING in one process
// so interference bursts hit both sides. Reports per-pair CPU-time ratios.
//
// Usage: node paired-e2e.js <ndjson-file> [pairs=5]
'use strict';
const { createReadStream } = require('fs');
const path = require('path');

const file = process.argv[2];
const PAIRS = +(process.argv[3] || 5);

const yajsBase = require(path.join(__dirname, 'baseline/dist/main/main.js'));
const yajsFinal = require(path.join(__dirname, 'dist-final/main/main.js'));

function runOnce(yajs) {
    return new Promise((resolve, reject) => {
        let count = 0;
        const w0 = process.hrtime.bigint();
        const c0 = process.cpuUsage();
        createReadStream(file).pipe(yajs('$.field2.nested')).
            on('data', () => count++).
            on('error', reject).
            on('end', () => {
                const c1 = process.cpuUsage(c0);
                const wall = Number(process.hrtime.bigint() - w0) / 1e6;
                if (count !== 2000000) { reject(new Error(`count ${count}`)); return; }
                resolve({ cpu: (c1.user + c1.system) / 1e3, wall });
            });
    });
}

(async () => {
    // Warmup both sides once.
    await runOnce(yajsBase);
    await runOnce(yajsFinal);
    console.error('warmup done');
    const ratios = [];
    for (let i = 0; i < PAIRS; i++) {
        const b = await runOnce(yajsBase);
        const f = await runOnce(yajsFinal);
        const r = f.cpu / b.cpu;
        ratios.push(r);
        console.log(`pair ${i + 1}: base cpu ${b.cpu.toFixed(0)} ms (wall ${b.wall.toFixed(0)})` +
            `  final cpu ${f.cpu.toFixed(0)} ms (wall ${f.wall.toFixed(0)})  ratio ${r.toFixed(3)}`);
    }
    ratios.sort((a, b) => a - b);
    const med = ratios[Math.floor(ratios.length / 2)];
    console.log(`e2e cpu ratio final/base: median ${med.toFixed(3)}` +
        ` [${ratios[0].toFixed(3)}..${ratios[ratios.length - 1].toFixed(3)}]`);
})().catch((e) => { console.error(e); process.exit(1); });
