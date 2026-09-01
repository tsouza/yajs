// Full-output differential on a slice of the real dataset: real engine vs
// chain vs generic, comparing complete emission streams.
'use strict';
const { readFileSync } = require('fs');
const { runReal } = require('./real');
const { compileFastPath, genericOnly } = require('./walker');

const file = process.argv[2];
const nLines = +(process.argv[3] || 2000);
const selectors = ['$.field2.nested', '$..entry1', '$.*', '$..*', '$', '$.field2.*'];

const lines = readFileSync(file, 'utf8').split('\n').slice(0, nLines).filter((l) => l.trim());
const input = lines.join('\n');

function stringifyOut(out) {
    return JSON.stringify(out, (k, v) =>
        typeof v === 'number' && Object.is(v, -0) ? '<<NEG0>>' : v);
}

(async () => {
    for (const sel of selectors) {
        const real = await runReal(sel, input);
        for (const force of [false, true]) {
            const out = [];
            const compiled = (force ? genericOnly : compileFastPath)(sel, undefined,
                (path, value) => out.push({ path, value }));
            for (const line of lines) { compiled.evaluator.walkDocument(JSON.parse(line)); }
            const same = stringifyOut(real.out) === stringifyOut(out);
            console.log(`${same ? 'SAME' : 'DIFF'} ${sel} kind=${compiled.kind} real=${real.out.length} fast=${out.length}`);
        }
    }
})();
