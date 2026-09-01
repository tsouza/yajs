// Phase 3 benchmark: WASM SIMD structural scan vs WASM scalar vs JS scalar
// vs JsonSaxParser full tokenize vs JSON.parse, all on the same bytes,
// chunked at 64KB, best-of-N with warmup. Copy-in cost to WASM memory is
// included in the WASM timings (that's real).
// Usage: node bench-scan.js <raw-ndjson-file> [reps]
'use strict';
const fs = require('fs');
const { JsonSaxParser } = require('../dist/main/lib/utils/JsonSaxParser.js');

const file = process.argv[2];
const REPS = +(process.argv[3] || 7);
const data = fs.readFileSync(file);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) {
    chunks.push(data.subarray(o, Math.min(o + CHUNK, data.length)));
}
const MB = data.length / (1024 * 1024);

const wasmBuf = fs.readFileSync(`${__dirname}/scanner.wasm`);
const { exports: W } = new WebAssembly.Instance(new WebAssembly.Module(wasmBuf));
const IN = W.INPUT_PTR.value;
const mem = new Uint8Array(W.memory.buffer);

function bench(name, fn) {
    fn(); // warmup 1
    fn(); // warmup 2
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

// ---- WASM variants (copy-in included) ----
function runWasm(fnName) {
    W.reset();
    let total = 0;
    for (const c of chunks) {
        mem.set(c, IN);
        let len = c.length;
        if (fnName === 'scanSimd' && (len & 63) !== 0) {
            const padded = (len + 63) & ~63;
            mem.fill(0x20, IN + len, IN + padded);
            len = padded;
        }
        total += W[fnName](len);
    }
    return total;
}

// ---- JS scalar control (same output contract) ----
const STRUCT = new Uint8Array(256);
for (const c of [0x7b, 0x7d, 0x5b, 0x5d, 0x3a, 0x2c, 0x22]) { STRUCT[c] = 1; }
const jsOut = new Int32Array(CHUNK);
function runJsScalar() {
    let total = 0;
    let inStr = false;
    let esc = false;
    for (const c of chunks) {
        let n = 0;
        for (let i = 0, l = c.length; i < l; i++) {
            const b = c[i];
            if (inStr) {
                if (esc) { esc = false; }
                else if (b === 0x5c) { esc = true; }
                else if (b === 0x22) { jsOut[n++] = i; inStr = false; }
            } else if (STRUCT[b] === 1) {
                jsOut[n++] = i;
                if (b === 0x22) { inStr = true; }
            }
        }
        total += n;
    }
    return total;
}

// ---- current tokenizer, no-op callbacks ----
function runSax() {
    let events = 0;
    const cb = {};
    for (const k of ['onBoolean', 'onColon', 'onComma', 'onEndArray',
        'onEndObject', 'onNull', 'onNumber', 'onStartArray', 'onStartObject',
        'onString']) { cb[k] = () => events++; }
    cb.onError = (e) => { throw e; };
    const p = new JsonSaxParser(cb);
    for (const c of chunks) { p.parse(c); }
    p.finish();
    return events;
}

// ---- JSON.parse per line ----
function runJsonParse() {
    let count = 0;
    let start = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0x0a) {
            if (JSON.parse(data.toString('utf8', start, i)) !== null) { count++; }
            start = i + 1;
        }
    }
    return count;
}

// ---- correctness: all three scanners agree on the first 2 chunks ----
(function verify() {
    W.reset();
    const sample = chunks.slice(0, 2);
    const results = [];
    for (const fnName of ['scanSimd', 'scanScalar']) {
        W.reset();
        const all = [];
        let chunkBase = 0;
        for (const c of sample) {
            mem.set(c, IN);
            let len = c.length;
            if (fnName === 'scanSimd' && (len & 63) !== 0) {
                const padded = (len + 63) & ~63;
                mem.fill(0x20, IN + len, IN + padded);
                len = padded;
            }
            const n = W[fnName](len);
            const out = new Uint32Array(W.memory.buffer, W.OUTPUT_PTR.value, n);
            for (let i = 0; i < n; i++) { all.push(chunkBase + out[i]); }
            chunkBase += c.length;
        }
        results.push(all);
    }
    // JS scalar over the sample
    {
        const all = [];
        let inStr = false;
        let esc = false;
        let chunkBase = 0;
        for (const c of sample) {
            for (let i = 0, l = c.length; i < l; i++) {
                const b = c[i];
                if (inStr) {
                    if (esc) { esc = false; }
                    else if (b === 0x5c) { esc = true; }
                    else if (b === 0x22) { all.push(chunkBase + i); inStr = false; }
                } else if (STRUCT[b] === 1) {
                    all.push(chunkBase + i);
                    if (b === 0x22) { inStr = true; }
                }
            }
            chunkBase += c.length;
        }
        results.push(all);
    }
    const [a, b, c] = results;
    const same = a.length === b.length && a.length === c.length &&
        a.every((v, i) => v === b[i] && v === c[i]);
    console.log(`verify: simd=${a.length} scalarWasm=${b.length} scalarJs=${c.length} identical=${same}`);
    if (!same) { throw new Error('scanner outputs differ'); }
})();

bench('wasm-simd-scan  ', () => runWasm('scanSimd'));
bench('wasm-scalar-scan', () => runWasm('scanScalar'));
bench('js-scalar-scan  ', runJsScalar);
bench('sax-tokenize    ', runSax);
bench('JSON.parse/line ', runJsonParse);
