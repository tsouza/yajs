// Tokenizer-only CPU-time baseline.
'use strict';
const fs = require('fs');
const { JsonSaxParser } = require('../dist/main/lib/utils/JsonSaxParser.js');
const data = fs.readFileSync(process.argv[2]);
const REPS = +(process.argv[3] || 7);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) {
    chunks.push(data.subarray(o, Math.min(o + CHUNK, data.length)));
}
const times = [];
for (let r = 0; r < REPS; r++) {
    let events = 0;
    const cb = {};
    for (const k of ['onBoolean', 'onColon', 'onComma', 'onEndArray', 'onEndObject',
        'onNull', 'onNumber', 'onStartArray', 'onStartObject', 'onString']) {
        cb[k] = () => events++;
    }
    cb.onError = (e) => { throw e; };
    const c0 = process.cpuUsage();
    const p = new JsonSaxParser(cb);
    for (const c of chunks) { p.parse(c); }
    p.finish();
    const c1 = process.cpuUsage(c0);
    times.push((c1.user + c1.system) / 1e3);
    if (events !== 25000000) { throw new Error('bad events ' + events); }
}
times.sort((a, b) => a - b);
console.log(`tokenize-noop: best ${times[0].toFixed(0)} ms  median ${times[Math.floor(times.length / 2)].toFixed(0)} ms  all=[${times.map((t) => t.toFixed(0)).join(',')}]`);
