// Differential tester: real yajs engine vs fast-path walker(s) on
// single-document inputs. Any divergence in content OR order is a finding.
// Usage: node diff.js [--seed N] [--n N] [--int-keys]
'use strict';
const { runReal } = require('./real');
const { compileFastPath, genericOnly } = require('./walker');

function stringifyOut(out) {
    // -0 must be visible in the comparison
    return JSON.stringify(out, (k, v) =>
        typeof v === 'number' && Object.is(v, -0) ? '<<NEG0>>' : v);
}

function runFast(selector, input, options, forceGeneric) {
    const out = [];
    const errors = [];
    let compiled;
    try {
        compiled = (forceGeneric ? genericOnly : compileFastPath)(
            selector, options, (path, value) => out.push({ path, value }));
    } catch (e) {
        return { out, errors: ['SELECTOR: ' + e.message], kind: 'none' };
    }
    let doc;
    try {
        doc = JSON.parse(input);
    } catch (e) {
        return { out, errors: ['UNPARSEABLE: ' + e.message], kind: compiled.kind };
    }
    try {
        compiled.evaluator.walkDocument(doc);
    } catch (e) {
        errors.push('WALKER THROW: ' + e.stack);
    }
    return { out, errors, kind: compiled.kind };
}

// --------------------------------------------------------------------------
// deterministic PRNG
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function makeGen(rand, keyPool) {
    const scalars = [1, -2.5, 0, true, false, null, 'v', '', 's2', 9007199254740993, 1e-3];
    function gen(depth) {
        const r = rand();
        if (depth <= 0 || r < 0.35) {
            return scalars[(rand() * scalars.length) | 0];
        }
        if (r < 0.7) {
            const n = (rand() * 4) | 0;
            const o = {};
            for (let i = 0; i < n; i++) {
                o[keyPool[(rand() * keyPool.length) | 0]] = gen(depth - 1);
            }
            return o;
        }
        const n = (rand() * 4) | 0;
        const a = [];
        for (let i = 0; i < n; i++) { a.push(gen(depth - 1)); }
        return a;
    }
    return gen;
}

// --------------------------------------------------------------------------

const MATRIX_INPUTS = [
    '{"a":1,"b":2}',
    '{"a":{"b":1}}',
    '{"a":{"b":{"c":1}}}',
    '{"a":[1,2,3]}',
    '{"a":[]}',
    '{"a":{}}',
    '{"a":[[1],2]}',
    '{"a":[[[1]],2]}',
    '{"a":[{"b":1},{"b":2}]}',
    '{"a":[[{"b":1}]]}',
    '{"a":[{"b":[1,2]}]}',
    '{"a":{"a":{"a":1}}}',
    '{"a":{"x":1,"b":{"a":{"x":2,"y":3}}}}',
    '{"x":{"a":1},"a":{"y":{"a":2}}}',
    '{"m":[[{"a":1}]]}',
    '{"array":[{"key1":{"child":"v1"}},{"key2":{"child":"v2"}}]}',
    '{"a":[{"key1":{"child":"v1"}},{"key3":{"child":"v3"}}]}',
    '{"a":{"c":{"a":{"x":1}}}}',
    '{"a":{"c":{"b":1}},"x":{"b":2}}',
    '{"a":5}',
    '{"a":"s"}',
    '{"a":null}',
    '{"a":[{"x":1},{"y":2},5,[6],null]}',
    '{"a":{"k1":1}}',
    '{"a":{"k1":1,"k2":2}}',
    '{"a":{"k2":2}}',
    '{"a":{"x":1,"z":{"x":9}}}',
    '[1,2,3]',
    '[[1],2]',
    '[[[1]],[2],3]',
    '[{"a":1},{"a":2}]',
    '[{"a":[{"b":1}]}]',
    '[]',
    '{}',
    '42',
    '"str"',
    'null',
    'true',
    '-0',
    '{"a":-0}',
    '{"__proto__":{"x":1}}',
    '{"a":{"__proto__":5}}',
    '{"toString":1,"a":2}',
    '{"a":{"toString":3}}',
    '{"":1,"a":{"":2}}',
    '{"a":{"b":[{"a":{"b":1}}]}}',
    '{"a":[{"a":[{"a":1}]}]}',
    '{"x":[{"x":[{"x":[5]}]}]}',
    '{"a":[[{"b":1},[{"b":2}]],{"b":3}]}',
    '{"key1":{"child":1},"child":2}',
];

const MATRIX_SELECTORS = [
    '$',
    '$.a',
    '$.a.b',
    '$.a.b.c',
    '$.b',
    '$.x.b',
    '$..a',
    '$..b',
    '$..child',
    '$.*',
    '$.*.*',
    '$..*',
    '$.a.*',
    '$.a..b',
    '$.*..b',
    '$.*..*',
    '$..a..b',
    '$..[key1]child',
    '$..[!key1]child',
    '$..[key1 || key2]child',
    '$..[key1 && a]child',
    '$..[a]b',
    '$..[!a]b',
    '$..[a]*',
    '$..[!a]*',
    '$.a{x}',
    '$.a{k1}',
    '$.a{k1 && k2}',
    '$.a{k1 || k2}',
    '$.a{!k1}',
    '$.a{!(k1 && k2)}',
    '$.a<x>',
    '$.a<x y>',
    '$..a<x>',
    '$.*<x>',
    '$..*{x}',
    '$.a.b{a}',
    '$..a{y}',
];

async function compareOne(sel, input, options, forceGeneric, findings, counts) {
    const real = await runReal(sel, input, options);
    const fast = runFast(sel, input, options, forceGeneric);
    if (fast.errors.some((e) => e.startsWith('SELECTOR'))) { return; }
    counts.total++;
    const a = stringifyOut(real.out);
    const b = stringifyOut(fast.out);
    const realErr = real.errors.length > 0;
    const fastErr = fast.errors.length > 0;
    if (a !== b || realErr !== fastErr) {
        counts.diff++;
        findings.push({
            sel, input: input.length > 120 ? input.slice(0, 120) + '...' : input,
            options, kind: fast.kind,
            real: a.length > 400 ? a.slice(0, 400) + '...' : a,
            fast: b.length > 400 ? b.slice(0, 400) + '...' : b,
            realErrors: real.errors, fastErrors: fast.errors,
        });
    }
}

(async () => {
    const argv = process.argv.slice(2);
    const seed = +(argv[argv.indexOf('--seed') + 1] || 12345);
    const nRandom = +(argv[argv.indexOf('--n') + 1] || 300);
    const intKeys = argv.includes('--int-keys');

    const findings = [];
    const counts = { total: 0, diff: 0 };

    // 1) feature matrix
    for (const sel of MATRIX_SELECTORS) {
        for (const input of MATRIX_INPUTS) {
            for (const options of [undefined, { pathIncludeArrayIndex: true }]) {
                await compareOne(sel, input, options, false, findings, counts);
                // also force the generic walker for chain-compilable
                // selectors, so both evaluators get coverage
                await compareOne(sel, input, options, true, findings, counts);
            }
        }
    }

    // 2) random documents
    const rand = mulberry32(seed);
    const keyPool = intKeys ?
        ['a', 'b', 'x', '2', '10', 'key1'] :
        ['a', 'b', 'c', 'x', 'y', 'key1', 'key2', 'child', 'k1'];
    const gen = makeGen(rand, keyPool);
    const randomSelectors = MATRIX_SELECTORS;
    for (let i = 0; i < nRandom; i++) {
        const doc = gen(4);
        const input = JSON.stringify(doc);
        if (input === undefined) { continue; }
        const sel = randomSelectors[(rand() * randomSelectors.length) | 0];
        const options = rand() < 0.3 ? { pathIncludeArrayIndex: true } : undefined;
        await compareOne(sel, input, options, rand() < 0.3, findings, counts);
    }

    console.log(JSON.stringify({ total: counts.total, divergences: counts.diff }, null, 1));
    for (const f of findings.slice(0, 40)) {
        console.log('----');
        console.log(JSON.stringify(f, null, 1));
    }
    if (findings.length > 40) { console.log(`... and ${findings.length - 40} more`); }
})();
