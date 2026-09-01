// Raw-text divergence probes: inputs whose textual form JSON.parse
// normalizes (duplicate keys, integer-like key order) plus NDJSON
// multi-line streams (real engine on whole stream vs fast path per line).
'use strict';
const { runReal } = require('./real');
const { compileFastPath } = require('./walker');

function stringifyOut(out) {
    return JSON.stringify(out, (k, v) =>
        typeof v === 'number' && Object.is(v, -0) ? '<<NEG0>>' : v);
}

function runFastLines(selector, input, options) {
    const out = [];
    const errors = [];
    const compiled = compileFastPath(selector, options,
        (path, value) => out.push({ path, value }));
    for (const line of input.split('\n')) {
        if (line.trim() === '') { continue; }
        let doc;
        try { doc = JSON.parse(line); } catch (e) { errors.push('UNPARSEABLE: ' + e.message); continue; }
        compiled.evaluator.walkDocument(doc);
    }
    return { out, errors, kind: compiled.kind };
}

const CASES = [
    // duplicate keys (real engine sees both; JSON.parse keeps last)
    ['$.a', '{"a":1,"a":2}'],
    ['$..a', '{"x":{"a":1,"a":2}}'],
    ['$', '{"a":1,"a":2}'],
    ['$.a.b', '{"a":{"b":1},"a":{"b":2}}'],
    // integer-like keys in non-JS order in the raw text
    ['$..b', '{"b0":{"b":1},"2":{"b":2},"1":{"b":3}}'],
    ['$.*', '{"zz":1,"10":2,"2":3}'],
    ['$', '{"zz":1,"10":2,"2":3}'],
    ['$..*', '{"10":{"x":1},"2":[5]}'],
    // -0 handling
    ['$.a', '{"a":-0}'],
    ['$', '-0'],
    ['$.*', '[-0]'],
    // big/edge numbers (SAX numeric parser vs JSON.parse)
    ['$.a', '{"a":1e400}'],
    ['$.a', '{"a":-1e-400}'],
    ['$.a', '{"a":9007199254740993}'],
    ['$.a', '{"a":123456789012345678901234567890}'],
    ['$.a', '{"a":1E+2}'],
    ['$.a', '{"a":0.1e-1}'],
    // unicode / escapes (tokenizer's own UTF-8/escape handling vs JSON.parse)
    ['$.a', '{"a":"\\u00e9\\n\\t\\"\\\\\\/x"}'],
    ['$.a', '{"a":"café ☃ 😀"}'],
    ['$.a', '{"a":"\\ud83d\\ude00"}'],
    ['$.a', '{"a":"lone\\ud800tail"}'],
    // whitespace forms
    ['$.a', '  {  "a" :  1  }  '],
    ['$.a', '\t{"a":\r\n1}'],
    // NDJSON multi-line
    ['$.a', '{"a":1}\n{"a":2}\n{"a":3}'],
    ['$.a', '{"a":1}\n\n\n{"a":2}'],
    ['$', '1\n2\n3'],
    ['$', '"x"\n"y"'],
    ['$.a', '{"a":[1,2]}\n{"a":{"b":1}}'],
    ['$..a', '{"a":{"a":1}}\n{"x":{"a":2}}'],
    ['$', '[1,2]\n[3]'],
    ['$', '{"a":1}\n[2,3]\n5'],
];

(async () => {
    for (const [sel, input, options] of CASES) {
        const real = await runReal(sel, input, options);
        const fast = runFastLines(sel, input, options);
        const a = stringifyOut(real.out);
        const b = stringifyOut(fast.out);
        const same = a === b && (real.errors.length > 0) === (fast.errors.length > 0);
        console.log(`${same ? 'SAME ' : 'DIFF '} ${sel}  << ${JSON.stringify(input).slice(0, 80)}`);
        if (!same) {
            console.log(`   real: ${a}  errs=${JSON.stringify(real.errors)}`);
            console.log(`   fast: ${b}  errs=${JSON.stringify(fast.errors)}`);
        }
    }
})();
