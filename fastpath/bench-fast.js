// End-to-end NDJSON benchmark: real SAX engine vs fast-path variants.
// Usage: node bench-fast.js <mode> <selector> <file>
//   mode: real | chain | generic | parseonly | splitonly
// Prints JSON {mode, selector, count, ms}.
'use strict';
const { createReadStream } = require('fs');
const { StringDecoder } = require('string_decoder');

const [, , mode, selector, file] = process.argv;

function done(count, start) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(JSON.stringify({ mode, selector, count, ms: +ms.toFixed(1) }));
}

if (mode === 'real') {
    const yajs = require('../dist/main/main.js');
    let count = 0;
    const start = process.hrtime.bigint();
    createReadStream(file).pipe(yajs(selector)).
        on('data', () => count++).
        on('error', (err) => { console.error(err.stack); process.exit(1); }).
        on('end', () => done(count, start));
} else {
    let evaluator = null;
    let count = 0;
    if (mode === 'chain' || mode === 'generic') {
        const { compileFastPath, genericOnly } = require('./walker');
        const compiled = (mode === 'generic' ? genericOnly : compileFastPath)(
            selector, undefined, () => count++);
        if (mode === 'chain' && compiled.kind !== 'chain') {
            console.error(`selector ${selector} is not chain-compilable`);
            process.exit(1);
        }
        evaluator = compiled.evaluator;
    }
    const decoder = new StringDecoder('utf8');
    // leftover kept as an array of parts: joining per chunk would be
    // O(N^2) across a record spanning many chunks (a 33MB single-line
    // record used to cost 14s in pure string copying here).
    const parts = [];
    const start = process.hrtime.bigint();
    const stream = createReadStream(file);
    stream.on('data', (chunk) => {
        const decoded = decoder.write(chunk);
        if (decoded.indexOf('\n') < 0) { parts.push(decoded); return; }
        parts.push(decoded);
        const s = parts.length === 1 ? decoded : parts.join('');
        parts.length = 0;
        let from = 0;
        for (;;) {
            const nl = s.indexOf('\n', from);
            if (nl < 0) { break; }
            const line = s.slice(from, nl);
            from = nl + 1;
            if (line.length === 0) { continue; }
            if (mode === 'splitonly') { count++; continue; }
            const doc = JSON.parse(line);
            if (mode === 'parseonly') { if (doc !== null) { count++; } continue; }
            evaluator.walkDocument(doc);
        }
        if (from < s.length) { parts.push(s.slice(from)); }
    });
    stream.on('end', () => {
        parts.push(decoder.end());
        const s = parts.join('');
        if (s.trim().length > 0) {
            if (mode === 'splitonly') { count++; }
            else if (mode === 'parseonly') { JSON.parse(s); count++; }
            else { evaluator.walkDocument(JSON.parse(s)); }
        }
        done(count, start);
    });
}
