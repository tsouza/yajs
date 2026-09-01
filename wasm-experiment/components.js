// Component-isolation timing for Phase 1 attribution.
// Loads dataset fully into memory, splits into 64KB chunks (like
// createReadStream), then times each component synchronously, best-of-N.
// Usage: node components.js <raw-ndjson-file> [reps]
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { JsonSaxParser } = require('../dist/main/lib/utils/JsonSaxParser.js');
const { StreamContext } = require('../dist/main/lib/context/StreamContext.js');
const { YAJSPath } = require('../dist/main/lib/path/YAJSPath.js');

const file = process.argv[2];
const REPS = +(process.argv[3] || 5);
const data = fs.readFileSync(file);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) {
    chunks.push(data.subarray(o, Math.min(o + CHUNK, data.length)));
}
const MB = data.length / (1024 * 1024);

function bench(name, fn) {
    let best = Infinity;
    const times = [];
    for (let r = 0; r < REPS; r++) {
        const t0 = process.hrtime.bigint();
        const out = fn();
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        times.push(ms);
        if (ms < best) { best = ms; }
        if (r === 0 && out !== undefined) { console.error(`  ${name} check: ${JSON.stringify(out)}`); }
    }
    console.log(`${name}: best ${best.toFixed(0)} ms  (${(MB / (best / 1000)).toFixed(1)} MB/s)  all=[${times.map((t) => t.toFixed(0)).join(',')}]`);
    return best;
}

const noop = () => { /* no-op */ };
const noopCallbacks = {
    onBoolean: noop, onColon: noop, onComma: noop, onEndArray: noop,
    onEndObject: noop, onNull: noop, onNumber: noop, onStartArray: noop,
    onStartObject: noop, onString: noop,
    onError: (e) => { throw e; },
};

// 1. Tokenizer only: JsonSaxParser with no-op callbacks.
bench('tokenize-noop', () => {
    let events = 0;
    const cb = {};
    for (const k of Object.keys(noopCallbacks)) { cb[k] = () => events++; }
    cb.onError = (e) => { throw e; };
    const p = new JsonSaxParser(cb);
    for (const c of chunks) { p.parse(c); }
    p.finish();
    return { events };
});

// 2. Tokenizer + StreamContext + matching + dispatch (no through stream):
// replicates yajs.ts's createSaxParser wiring minus stream plumbing.
function tokenizeMatch(name, pathExpr) {
  bench(name, () => {
    let matches = 0;
    const yajsPath = YAJSPath.parse(pathExpr);
    const context = new StreamContext(yajsPath, () => matches++, false,
        (err) => { throw err; });
    let strValue = null;
    const flush = () => {
        if (strValue != null) { context.onValue(strValue); strValue = null; }
    };
    const p = new JsonSaxParser({
        onBoolean: (b) => { strValue = null; context.onValue(b); },
        onColon: () => { context.startObjectEntry(strValue); strValue = null; },
        onComma: () => flush(),
        onEndArray: () => { flush(); context.endArray(); },
        onEndObject: () => { flush(); context.endObject(); },
        onError: (e) => { throw e; },
        onNull: () => { strValue = null; context.onValue(null); },
        onNumber: (n) => { strValue = null; context.onValue(n); },
        onStartArray: () => { strValue = null; context.startArray(); },
        onStartObject: () => { strValue = null; context.startObject(); },
        onString: (s) => { flush(); strValue = s; },
        onValueBoundary: () => flush(),
    });
    for (const c of chunks) { p.parse(c); }
    p.finish();
    flush();
    return { matches };
  });
}
tokenizeMatch('tokenize+match', '$.field2.nested');
tokenizeMatch('tokenize+nomatch', '$.zzz.qqq');

// 3. JSON.parse per line (V8-native reference).
bench('JSON.parse/line', () => {
    let count = 0;
    let start = 0;
    const text = data; // Buffer
    for (let i = 0; i < text.length; i++) {
        if (text[i] === 0x0a) {
            const obj = JSON.parse(text.toString('utf8', start, i));
            if (obj !== null) { count++; }
            start = i + 1;
        }
    }
    return { count };
});

// 4. gunzip (sync, whole-buffer) of the .gz for scale.
const gzFile = process.argv[4];
if (gzFile) {
    const gzData = fs.readFileSync(gzFile);
    bench('gunzipSync', () => {
        const out = zlib.gunzipSync(gzData);
        return { bytes: out.length };
    });
}
