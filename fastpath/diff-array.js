// Differential test for the TOP-LEVEL-ARRAY fast path: real engine on the
// full array text vs per-element walk (chain walkElement + generic
// element()). Elements here come from JSON.parse of the whole doc; the
// byte-span scanner is tested separately (scan-test.js).
'use strict';
const { runReal } = require('./real');
const { compileFastPath, genericOnly } = require('./walker');

function stringifyOut(out) {
    return JSON.stringify(out, (k, v) =>
        typeof v === 'number' && Object.is(v, -0) ? '<<NEG0>>' : v);
}

function runFastArray(selector, elements, options, forceGeneric) {
    const out = [];
    const compiled = (forceGeneric ? genericOnly : compileFastPath)(
        selector, options, (path, value) => out.push({ path, value }));
    const ev = compiled.evaluator;
    if (compiled.kind === 'chain') {
        for (let i = 0; i < elements.length; i++) { ev.walkElement(elements[i], i); }
    } else {
        ev.walkRootArrayOpen();
        for (let i = 0; i < elements.length; i++) { ev.element(elements[i]); }
        ev.walkRootArrayClose();
    }
    return { out, kind: compiled.kind };
}

const ARRAY_INPUTS = [
    '[{"a":1},{"a":2}]',
    '[{"a":[1,2]},{"a":{"b":3}}]',
    '[[{"a":1}],{"a":2}]',
    '[1,[2],{"x":3},null,"s"]',
    '[]',
    '[[],{},[[]]]',
    '[{"field1":"v","field2":{"nested":[{"e":1},{"e":2}]}}]',
    '[{"a":{"a":[{"a":1}]}}]',
    '[{"key1":{"child":1}},{"key2":{"child":2}}]',
    '[{"a":{"x":1,"y":2}},{"a":{"y":3}},{"a":5}]',
    '[[1,[2]],[3]]',
    '[{"b":[{"b":1}]}]',
];

const SELECTORS = [
    '$', '$.a', '$.a.b', '$.*', '$..a', '$..*', '$.a.*',
    '$.field2.nested', '$..child', '$..[key1]child', '$.a{x}', '$.a<x>',
    '$..e', '$.b..b',
];

(async () => {
    let total = 0;
    let diffs = 0;
    for (const sel of SELECTORS) {
        for (const input of ARRAY_INPUTS) {
            for (const options of [undefined, { pathIncludeArrayIndex: true }]) {
                for (const forceGeneric of [false, true]) {
                    const real = await runReal(sel, input, options);
                    const elements = JSON.parse(input);
                    const fast = runFastArray(sel, elements, options, forceGeneric);
                    total++;
                    const a = stringifyOut(real.out);
                    const b = stringifyOut(fast.out);
                    if (a !== b) {
                        diffs++;
                        console.log(`DIFF ${sel} ${options ? 'idx' : ''} kind=${fast.kind} << ${input}`);
                        console.log(`  real: ${a}`);
                        console.log(`  fast: ${b}`);
                    }
                }
            }
        }
    }
    console.log(JSON.stringify({ total, diffs }));
})();
