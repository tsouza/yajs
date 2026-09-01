// Top-level-array fast path benchmark + differential check.
// Usage: node bench-array.js <mode> <selector> <file>
//   mode: real | achain | ageneric | asplitonly | aparseonly
'use strict';
const { createReadStream } = require('fs');
const { ArrayElementSplitter } = require('./arraysplit');

const [, , mode, selector, file] = process.argv;

function done(count, start, splitter) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(JSON.stringify({ mode, selector, count, ms: +ms.toFixed(1),
        maxPending: splitter ? splitter.maxPending : undefined }));
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
    const { compileFastPath, genericOnly } = require('./walker');
    let count = 0;
    let onElement;
    let evaluator = null;
    let kind = null;
    if (mode === 'achain' || mode === 'ageneric') {
        const compiled = (mode === 'ageneric' ? genericOnly : compileFastPath)(
            selector, undefined, () => count++);
        evaluator = compiled.evaluator;
        kind = compiled.kind;
        if (mode === 'achain' && kind !== 'chain') {
            console.error('not chain-compilable'); process.exit(1);
        }
        if (kind === 'chain') {
            let idx = 0;
            onElement = (text) => evaluator.walkElement(JSON.parse(text), idx++);
        } else {
            evaluator.walkRootArrayOpen();
            onElement = (text) => evaluator.element(JSON.parse(text));
        }
    } else if (mode === 'aparseonly') {
        onElement = (text) => { if (JSON.parse(text) !== null) { count++; } };
    } else { // asplitonly
        onElement = () => count++;
    }
    const splitter = new ArrayElementSplitter(onElement);
    const start = process.hrtime.bigint();
    const stream = createReadStream(file);
    stream.on('data', (chunk) => splitter.write(chunk));
    stream.on('end', () => {
        splitter.end();
        if (evaluator && kind === 'generic') { evaluator.walkRootArrayClose(); }
        done(count, start, splitter);
    });
}
