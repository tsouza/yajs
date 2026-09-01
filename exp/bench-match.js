// Match-layer benchmark: tokenize+match and tokenize+nomatch, best/median of N.
// Usage: node bench-match.js <file> [reps]
'use strict';
const fs = require('fs');
const { JsonSaxParser } = require('../dist/main/lib/utils/JsonSaxParser.js');
const { StreamContext } = require('../dist/main/lib/context/StreamContext.js');
const { YAJSPath } = require('../dist/main/lib/path/YAJSPath.js');

const file = process.argv[2];
const REPS = +(process.argv[3] || 7);
const data = fs.readFileSync(file);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) {
    chunks.push(data.subarray(o, Math.min(o + CHUNK, data.length)));
}

function run(pathExpr) {
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
    return matches;
}

function bench(name, pathExpr, expected) {
    const times = [];
    for (let r = 0; r < REPS; r++) {
        const c0 = process.cpuUsage();
        const m = run(pathExpr);
        const c1 = process.cpuUsage(c0);
        times.push((c1.user + c1.system) / 1e3);
        if (m !== expected) { throw new Error(`${name}: got ${m} matches, want ${expected}`); }
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    console.log(`${name}: best ${times[0].toFixed(0)} ms  median ${med.toFixed(0)} ms  all=[${times.map((t) => t.toFixed(0)).join(',')}]`);
}

bench('tokenize+match', '$.field2.nested', 2000000);
bench('tokenize+nomatch', '$.zzz.qqq', 0);
