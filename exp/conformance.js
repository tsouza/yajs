// Differential conformance: base vs final must produce identical outputs
// (paths + values, in order) across a battery of selectors and documents.
'use strict';
const path = require('path');

const variants = {
    base: require(path.join(__dirname, 'baseline/dist/main/main.js')),
    final: require(path.join(__dirname, 'dist-final/main/main.js')),
};

const docs = [
    '{"field1":"value1","field2":{"nested":[{"entry1":"value"},{"entry2":"value"}]}}\n{"field2":{"nested":[1,2]}}',
    '{"a":{"c":{"a":{"x":1}}}}',
    '{"a":[[{"x":1}],2,[3]]}',
    '[1,2,3]\n[4,5]',
    '{"m":[[{"a":1}]]}',
    '{"a":[{"x":1},{"x":[2,3]}],"b":{"a":{"y":9}}}',
    '"bare"\n42\ntrue\nnull',
    '{"__proto__":{"polluted":1},"toString":5}',
    '{"a":{"b":{"c":{"d":1}}}}',
    '{"x":[{"deep":1}]}',
];

const selectors = [
    '$', '$.a', '$.*', '$.*.*', '$..a', '$..x', '$.a..x', '$..*',
    '$.field2.nested', '$.a.x', '$.m', '$.a{x}', '$.b.a',
];

function collect(yajs, sel, doc, includeIdx) {
    return new Promise((resolve, reject) => {
        const out = [];
        const s = yajs(sel, { pathIncludeArrayIndex: includeIdx });
        s.on('data', (d) => out.push(d)).
            on('error', (e) => resolve(['ERROR', String(e.message)])).
            on('end', () => resolve(out));
        s.write(Buffer.from(doc));
        s.end();
    });
}

(async () => {
    let checked = 0;
    let failed = 0;
    for (const sel of selectors) {
        for (const doc of docs) {
            for (const idx of [false, true]) {
                const [b, f] = [
                    await collect(variants.base, sel, doc, idx),
                    await collect(variants.final, sel, doc, idx),
                ];
                checked++;
                const jb = JSON.stringify(b);
                const jf = JSON.stringify(f);
                if (jb !== jf) {
                    failed++;
                    console.log(`MISMATCH sel=${sel} idx=${idx} doc=${doc.slice(0, 60)}`);
                    console.log(`  base : ${jb.slice(0, 300)}`);
                    console.log(`  final: ${jf.slice(0, 300)}`);
                }
            }
        }
    }
    console.log(`conformance: ${checked} cases, ${failed} mismatches`);
})();
