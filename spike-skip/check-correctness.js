// Differential check: prototype vs real yajs engine, on a handful of
// records from each sample dataset. Not exhaustive - just enough to trust
// the benchmark numbers are measuring something that actually works.
'use strict';
const fs = require('fs');
const readline = require('readline');
const { PassThrough } = require('stream');
const path = require('path');
const { extractDescendant } = require('./proto');
const yajs = require(path.join(__dirname, '..', 'dist', 'main', 'main.js'));

async function yajsCollect(selector, text) {
    return new Promise((resolve, reject) => {
        const out = [];
        const p = new PassThrough();
        p.pipe(yajs(selector)).
            on('data', (d) => out.push(d.value)).
            on('error', reject).
            on('end', () => resolve(out));
        p.end(text);
    });
}

async function checkNdjson(file, needle, selector, n) {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    let i = 0;
    let mismatches = 0;
    for await (const line of rl) {
        if (!line.trim()) continue;
        if (i >= n) break;
        i++;
        const buf = Buffer.from(line, 'utf8');
        const proto = extractDescendant(buf, needle);
        const real = await yajsCollect(selector, line);
        const a = JSON.stringify(proto);
        const b = JSON.stringify(real);
        if (a !== b) {
            mismatches++;
            console.log('MISMATCH at record', i);
            console.log('  proto:', a.slice(0, 300));
            console.log('  real :', b.slice(0, 300));
        }
    }
    console.log(`${file}: checked ${i} records, ${mismatches} mismatches`);
}

async function checkWholeDoc(file, needle, selector) {
    const buf = fs.readFileSync(file);
    const proto = extractDescendant(buf, needle);
    const real = await yajsCollect(selector, buf.toString('utf8'));
    const a = JSON.stringify(proto);
    const b = JSON.stringify(real);
    console.log(`${file}: proto ${proto.length} matches, real ${real.length} matches, equal=${a === b}`);
    if (a !== b) {
        console.log('  proto[0..3]:', JSON.stringify(proto.slice(0, 3)));
        console.log('  real [0..3]:', JSON.stringify(real.slice(0, 3)));
    }
}

(async () => {
    const SCRATCH = process.argv[2];
    await checkNdjson(path.join(SCRATCH, 'data-1.ndjson'), Buffer.from('"nested":'), '$.field2.nested', 500);
    await checkNdjson(path.join(SCRATCH, 'data-2-sample.ndjson'), Buffer.from('"plugins":'), '$..plugins', 200);
    await checkWholeDoc(path.join(SCRATCH, 'data-4-sample.json'), Buffer.from('"deep1":'), '$..array.deep1');
})().catch((e) => { console.error(e); process.exit(1); });
