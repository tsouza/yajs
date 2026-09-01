// Differential: full pipeline (scanner + parse + walk) vs REAL engine on
// top-level-array text, comparing full emission streams (path AND value AND
// order), fed in randomized small chunks to exercise chunk boundaries.
'use strict';
const { runReal } = require('./real');
const { ArrayElementSplitter } = require('./arraysplit');
const { compileFastPath, genericOnly } = require('./walker');

function stringifyOut(out) {
    return JSON.stringify(out, (k, v) =>
        typeof v === 'number' && Object.is(v, -0) ? '<<NEG0>>' : v);
}

function runFastArrayText(selector, text, options, forceGeneric, chunkSize) {
    const out = [];
    const compiled = (forceGeneric ? genericOnly : compileFastPath)(
        selector, options, (path, value) => out.push({ path, value }));
    const ev = compiled.evaluator;
    let onElement;
    if (compiled.kind === 'chain') {
        let idx = 0;
        onElement = (t) => ev.walkElement(JSON.parse(t), idx++);
    } else {
        ev.walkRootArrayOpen();
        onElement = (t) => ev.element(JSON.parse(t));
    }
    const splitter = new ArrayElementSplitter(onElement);
    const buf = Buffer.from(text);
    for (let o = 0; o < buf.length; o += chunkSize) {
        splitter.write(buf.subarray(o, Math.min(o + chunkSize, buf.length)));
    }
    splitter.end();
    if (compiled.kind === 'generic') { ev.walkRootArrayClose(); }
    return { out, kind: compiled.kind };
}

const INPUTS = [
    '[{"a":1},{"a":2}]',
    '[ {"a": [1, 2]} , {"a":{"b":3}} ]',
    '[[{"a":1}],{"a":2},[],{},"s,x","a]b",-1.5e2,null,true]',
    '[{"field1":"v1","field2":{"nested":[{"e":1},{"e":2}]}},{"field2":{"nested":[]}},{"field2":5}]',
    '[{"s":"br]ack{ets\\",comma,"}]',
    '[1,2,3]',
    '[]',
    '[ ]',
    '[{"a":{"x":1,"y":2}},{"a":{"y":3}},{"a":5},[{"a":6}]]',
    '[\n {"a":1},\n {"a":[{"b":1},[{"b":2}]]}\n]',
    '[{"a":"café ☃ 😀"},{"a":"日本語, tes\\"t"},"☃☃☃"]',
];
const SELECTORS = ['$', '$.a', '$.a.b', '$.*', '$..a', '$..*', '$.field2.nested', '$..b', '$.a{x}', '$.a<x>'];

(async () => {
    let total = 0, diffs = 0;
    for (const sel of SELECTORS) {
        for (const input of INPUTS) {
            for (const options of [undefined, { pathIncludeArrayIndex: true }]) {
                for (const chunkSize of [1, 3, 7, 1 << 20]) {
                    for (const forceGeneric of [false, true]) {
                        const real = await runReal(sel, input, options);
                        let fast;
                        try {
                            fast = runFastArrayText(sel, input, options, forceGeneric, chunkSize);
                        } catch (e) {
                            fast = { out: [{ ERROR: e.message }], kind: '?' };
                        }
                        total++;
                        const a = stringifyOut(real.out);
                        const b = stringifyOut(fast.out);
                        if (a !== b) {
                            diffs++;
                            console.log(`DIFF ${sel} chunk=${chunkSize} ${options ? 'idx' : ''} kind=${fast.kind} << ${input}`);
                            console.log(`  real: ${a}`);
                            console.log(`  fast: ${b}`);
                        }
                    }
                }
            }
        }
    }
    console.log(JSON.stringify({ total, diffs }));
})();
