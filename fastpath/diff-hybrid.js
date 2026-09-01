// Differential check of the hybrid navigator on tricky NDJSON content:
// real engine emissions vs bench-hybrid.js HYBRID_DUMP output.
'use strict';
const { writeFileSync } = require('fs');
const { execFileSync } = require('child_process');
const { runReal } = require('./real');

const TRICKY = [
    '{"field1":"v","field2":{"nested":[{"e":1},{"e":2}]}}',
    '{"field2":{"nested":5}}',
    '{"field2":{"nested":"str with } { : , \\" inside"}}',
    '{"field2":{"nested":{"a":{"field2":{"nested":"decoy-deeper"}}}}}',
    '{"decoy":{"field2":{"nested":"not-at-depth-1... wait, it is at its own chain"}},"field2":{"nested":1}}',
    '{"field2":{"other":1,"nested":[1,[2],{"x":3}],"post":2}}',
    '{"field2":{"nested":[]}}',
    '{"field2":5}',
    '{"nofield":1}',
    '{"field2":{"deeper":{"nested":"wrong-depth"}}}',
    '{"a":"field2","b":"\\"nested\\":","field2":{"c":":","nested":true}}',
    '{"field2":{"nested":null},"tail":{"deep":{"deeper":[1,2,{"x":[[]]}]}}}',
    '{"field2":{"nested":{"uni":"café ☃ 😀"}}}',
    '{"field2" :  {  "nested" : [ 1 , 2 ] } }',
    '{"field2":{"nested":-1.5e-3}}',
];

const input = TRICKY.join('\n') + '\n';
const tmp = '/tmp/claude-1000/-home-thiago-workspace-yajs/6f320fb9-93d1-4710-976d-a4516162334f/scratchpad/hybrid-tricky.ndjson';
writeFileSync(tmp, input);

function stringifyOut(out) { return JSON.stringify(out); }

(async () => {
    const real = await runReal('$.field2.nested', input);
    const raw = execFileSync('node', [__dirname + '/bench-hybrid.js', '$.field2.nested', tmp],
        { env: { ...process.env, HYBRID_DUMP: '1' } }).toString().trim().split('\n');
    const stats = raw.pop(); // last line is the timing JSON
    const fast = raw.filter((l) => l).map((l) => JSON.parse(l));
    const a = stringifyOut(real.out);
    const b = stringifyOut(fast);
    console.log(a === b ? 'SAME' : 'DIFF', `real=${real.out.length} fast=${fast.length}`, stats);
    if (a !== b) {
        console.log('real:', a);
        console.log('fast:', b);
    }
})();
