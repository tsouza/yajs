// Interleaved multi-variant benchmark for the match/dispatch layer.
//
// Runs all dist variants round-robin in ONE process (so bursty machine
// interference hits every variant roughly equally), measuring per-rep CPU
// time (user+system, robust to scheduler contention). Reports per-variant
// medians and per-round ratios vs base (each round times base and the
// variant seconds apart).
//
// Usage: node rotation.js <ndjson-file> [rounds=6]
// Variants are resolved relative to this script's directory.
'use strict';
const fs = require('fs');
const path = require('path');

const VARIANTS = [
    ['base', 'baseline/dist'],       // git HEAD
    ['final', 'dist-final'],         // all opts 1-6
    ['s1', 'dist-s1'],               // opt1 only (defineProperty guard)
    ['s2', 'dist-s2'],               // opt1+2 (+closure removal)
    ['noopt3', 'dist-noopt3'],       // final minus dispatcher pooling
    ['noopt4', 'dist-noopt4'],       // final minus StreamPosition reuse
    ['noopt5', 'dist-noopt5'],       // final minus depth gate
    ['noopt6', 'dist-noopt6'],       // final minus wrapper reuse
];

const file = process.argv[2];
const ROUNDS = +(process.argv[3] || 6);
const data = fs.readFileSync(file);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) {
    chunks.push(data.subarray(o, Math.min(o + CHUNK, data.length)));
}

const mods = new Map();
for (const [name, rel] of VARIANTS) {
    const root = path.join(__dirname, rel, 'main', 'lib');
    mods.set(name, {
        JsonSaxParser: require(path.join(root, 'utils', 'JsonSaxParser.js')).JsonSaxParser,
        StreamContext: require(path.join(root, 'context', 'StreamContext.js')).StreamContext,
        YAJSPath: require(path.join(root, 'path', 'YAJSPath.js')).YAJSPath,
    });
}

function run(mod, pathExpr) {
    let matches = 0;
    const yajsPath = mod.YAJSPath.parse(pathExpr);
    const context = new mod.StreamContext(yajsPath, () => matches++, false,
        (err) => { throw err; });
    let strValue = null;
    const flush = () => {
        if (strValue != null) { context.onValue(strValue); strValue = null; }
    };
    const p = new mod.JsonSaxParser({
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

function timed(mod, pathExpr, expected) {
    const c0 = process.cpuUsage();
    const m = run(mod, pathExpr);
    const c1 = process.cpuUsage(c0);
    if (m !== expected) { throw new Error(`got ${m} matches, want ${expected}`); }
    return (c1.user + c1.system) / 1e3;
}

const CASES = [
    ['match', '$.field2.nested', 2000000],
    ['nomatch', '$.zzz.qqq', 0],
];

// results[case][variant] = [ms per round]
const results = {};
for (const [cname] of CASES) {
    results[cname] = {};
    for (const [vname] of VARIANTS) { results[cname][vname] = []; }
}

// Warmup: one pass of every variant/case (JIT steady state), not recorded.
for (const [vname] of VARIANTS) {
    for (const [, expr, expected] of CASES) { timed(mods.get(vname), expr, expected); }
}
console.error('warmup done');

for (let round = 0; round < ROUNDS; round++) {
    // base and final always adjacent (the headline pair); the rest rotate.
    const rest = VARIANTS.slice(2).map(([n]) => n);
    for (let i = 0; i < round % rest.length; i++) { rest.push(rest.shift()); }
    const order = ['base', 'final', ...rest];
    for (const [cname, expr, expected] of CASES) {
        for (const vname of order) {
            results[cname][vname].push(timed(mods.get(vname), expr, expected));
        }
    }
    console.error(`round ${round + 1}/${ROUNDS} done`);
}

const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

for (const [cname] of CASES) {
    console.log(`\n== ${cname} ==`);
    const base = results[cname].base;
    for (const [vname] of VARIANTS) {
        const times = results[cname][vname];
        const ratios = times.map((t, i) => t / base[i]);
        const rMed = median(ratios);
        console.log(
            `${vname.padEnd(8)} median ${median(times).toFixed(0).padStart(6)} ms` +
            `  ratio-vs-base median ${rMed.toFixed(3)}` +
            ` [${Math.min(...ratios).toFixed(3)}..${Math.max(...ratios).toFixed(3)}]` +
            `  all=[${times.map((t) => t.toFixed(0)).join(',')}]`);
    }
}
