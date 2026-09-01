// Measures what a REAL batch-oriented integration would cost:
//   stage 1: WASM SIMD structural scan (chunked, copy-in included),
//            indices accumulated into one big Uint32Array
//   stage 2: JS walks the index list, materializes every string span as a
//            JS string (buffer.toString), and fires SAX-equivalent no-op
//            callbacks - the events StreamContext would consume.
// This is the honest "replacement tokenizer" number to compare against
// JsonSaxParser's 4.2s, because StreamContext still needs discrete events
// and JS strings for key matching.
// Usage: node stage2.js <raw-ndjson-file> [reps]
'use strict';
const fs = require('fs');

const file = process.argv[2];
const REPS = +(process.argv[3] || 7);
const data = fs.readFileSync(file);
const CHUNK = 64 * 1024;
const MB = data.length / (1024 * 1024);

const wasmBuf = fs.readFileSync(`${__dirname}/scanner.wasm`);
const { exports: W } = new WebAssembly.Instance(new WebAssembly.Module(wasmBuf));
const IN = W.INPUT_PTR.value;
const OUT = W.OUTPUT_PTR.value;
const mem = new Uint8Array(W.memory.buffer);

const indices = new Uint32Array(48_000_000); // 33M needed for dataset 1

function stage1() {
    W.reset();
    let n = 0;
    for (let o = 0; o < data.length; o += CHUNK) {
        const c = data.subarray(o, Math.min(o + CHUNK, data.length));
        mem.set(c, IN);
        let len = c.length;
        if ((len & 63) !== 0) {
            const padded = (len + 63) & ~63;
            mem.fill(0x20, IN + len, IN + padded);
            len = padded;
        }
        const k = W.scanSimd(len);
        const out = new Uint32Array(W.memory.buffer, OUT, k);
        for (let i = 0; i < k; i++) { indices[n + i] = o + out[i]; }
        n += k;
    }
    return n;
}

// Stage 2: SAX-equivalent event stream out of the index list.
// Structural chars fire an event each; a quote pair materializes one JS
// string and fires onString. Value spans between structural positions that
// aren't strings (numbers/true/false/null) would need slicing+Number() -
// dataset 1 has none, noted in the report.
let events = 0;
let strBytes = 0;
const onEvent = () => events++;
const onString = (s) => { events++; strBytes += s.length; };

function stage2(n) {
    events = 0;
    strBytes = 0;
    let i = 0;
    while (i < n) {
        const pos = indices[i];
        const b = data[pos];
        if (b === 0x22) { // quote: next index is the closing quote
            const close = indices[i + 1];
            // (escape check: dataset has none; a real impl re-checks a
            // has-escape bit from stage 1 and takes a slow path)
            onString(data.toString('utf8', pos + 1, close));
            i += 2;
        } else {
            onEvent(); // { } [ ] : ,
            i += 1;
        }
    }
    return events;
}

function bench(name, fn) {
    fn(); fn(); // warmup
    let best = Infinity;
    const times = [];
    let check;
    for (let r = 0; r < REPS; r++) {
        const t0 = process.hrtime.bigint();
        check = fn();
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        times.push(+ms.toFixed(0));
        if (ms < best) { best = ms; }
    }
    console.log(`${name}: best ${best.toFixed(0)} ms  (${(MB / (best / 1000)).toFixed(1)} MB/s)  check=${JSON.stringify(check)}  all=[${times.join(',')}]`);
    return best;
}

// Variant: same walk, but no string materialization (span positions only) -
// isolates the JS-string-building cost from the walk+dispatch cost.
function stage2NoStrings(n) {
    events = 0;
    strBytes = 0;
    let i = 0;
    while (i < n) {
        const pos = indices[i];
        if (data[pos] === 0x22) {
            strBytes += indices[i + 1] - pos - 1;
            events++;
            i += 2;
        } else {
            onEvent();
            i += 1;
        }
    }
    return events;
}

const n = stage1();
console.log(`indices: ${n}`);
const t1 = bench('stage1-simd+collect', stage1);
const t2 = bench('stage2-js-walk     ', () => stage2(n));
bench('stage2-no-strings  ', () => stage2NoStrings(n));
console.log(`combined: ${(t1 + t2).toFixed(0)} ms (${(MB / ((t1 + t2) / 1000)).toFixed(1)} MB/s), strBytes=${strBytes}, events=${events}`);
