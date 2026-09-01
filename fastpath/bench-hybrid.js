// Hybrid span-engine prototype: structural scanner navigates each NDJSON
// record's object structure (SKIP/DESCEND), and span-parses only the VALUE
// of a pure-key chain selector (PARSE) via JSON.parse on the value's byte
// span. No SAX tokenizing, no dispatcher building, no full-line parse.
//
// Prototype limits (documented, not fundamental): whole file read into one
// Buffer (cross-chunk span carry is measured separately in arraysplit);
// pure object-key chains only (no arrays mid-chain, which dataset 1's
// selector doesn't need); keys compared as raw bytes (escaped keys would
// need decoding).
//
// Usage: node bench-hybrid.js <selector> <file>
'use strict';
const { readFileSync } = require('fs');
const { compileFastPath } = require('./walker');

const [, , selector, file] = process.argv;

const DUMP = !!process.env.HYBRID_DUMP;
const compiled = compileFastPath(selector, undefined, (path, value) => {
    count++;
    if (DUMP) { console.log(JSON.stringify({ path, value })); }
});
if (compiled.kind !== 'chain') { console.error('chain selectors only'); process.exit(1); }
const chain = compiled.evaluator.keys.map((k) => Buffer.from(k));
const terminalEval = compiled.evaluator;
let count = 0;

const OPEN_BRACE = 0x7b, CLOSE_BRACE = 0x7d, OPEN_BRACKET = 0x5b, CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22, BACKSLASH = 0x5c, COMMA = 0x2c, COLON = 0x3a;

function keyEquals(buf, s, e, key) {
    if (e - s !== key.length) { return false; }
    for (let i = 0; i < key.length; i++) {
        if (buf[s + i] !== key[i]) { return false; }
    }
    return true;
}

const start = process.hrtime.bigint();
const buf = readFileSync(file);
const len = buf.length;

// chainIdxStack[d] = chain position the container at depth d is searching
// (-1 = dead subtree: SKIP mode). Depth 0 is "between records".
const chainIdxStack = new Int32Array(1024);
let depth = 0;
let i = 0;

while (i < len) {
    const b = buf[i];
    // between-records / inside-record dispatch
    if (depth === 0) {
        if (b === OPEN_BRACE) {
            depth = 1;
            chainIdxStack[1] = 0;
            i++;
            continue;
        }
        // non-object top-level value: skip to newline (dataset has none)
        i++;
        continue;
    }
    const ci = chainIdxStack[depth];
    if (ci < 0) {
        // SKIP mode: raw structural scan until this container closes
        if (b === QUOTE) {
            i++;
            while (i < len) {
                const c = buf[i];
                if (c === BACKSLASH) { i += 2; continue; }
                if (c === QUOTE) { break; }
                i++;
            }
        } else if (b === OPEN_BRACE || b === OPEN_BRACKET) {
            depth++;
            chainIdxStack[depth] = -1;
        } else if (b === CLOSE_BRACE || b === CLOSE_BRACKET) {
            depth--;
        }
        i++;
        continue;
    }
    // DESCEND mode: we are directly inside a live object container; find
    // keys, compare with chain[ci].
    if (b === QUOTE) {
        // read key (or a string value in an array... live containers are
        // always objects here since chain keys only descend objects)
        const ks = i + 1;
        i++;
        let sawEsc = false;
        while (i < len) {
            const c = buf[i];
            if (c === BACKSLASH) { sawEsc = true; i += 2; continue; }
            if (c === QUOTE) { break; }
            i++;
        }
        const ke = i;
        i++; // past closing quote
        // expect colon (a key) - inside an object it must be
        while (i < len && buf[i] !== COLON && buf[i] !== COMMA &&
               buf[i] !== CLOSE_BRACE) { i++; }
        if (buf[i] !== COLON) { continue; } // not a key (defensive)
        i++;
        while (i < len && (buf[i] === 0x20 || buf[i] === 0x09 ||
               buf[i] === 0x0a || buf[i] === 0x0d)) { i++; }
        const isMatch = !sawEsc && keyEquals(buf, ks, ke, chain[ci]);
        const vb = buf[i];
        if (isMatch && ci === chain.length - 1) {
            // PARSE: span-capture this value
            const vs = i;
            if (vb === OPEN_BRACE || vb === OPEN_BRACKET) {
                let d2 = 0;
                while (i < len) {
                    const c = buf[i];
                    if (c === QUOTE) {
                        i++;
                        while (i < len) {
                            const c2 = buf[i];
                            if (c2 === BACKSLASH) { i += 2; continue; }
                            if (c2 === QUOTE) { break; }
                            i++;
                        }
                    } else if (c === OPEN_BRACE || c === OPEN_BRACKET) { d2++; }
                    else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) {
                        d2--;
                        if (d2 === 0) { i++; break; }
                    }
                    i++;
                }
            } else if (vb === QUOTE) {
                i++;
                while (i < len) {
                    const c = buf[i];
                    if (c === BACKSLASH) { i += 2; continue; }
                    if (c === QUOTE) { i++; break; }
                    i++;
                }
            } else {
                while (i < len && buf[i] !== COMMA && buf[i] !== CLOSE_BRACE &&
                       buf[i] !== CLOSE_BRACKET && buf[i] !== 0x0a &&
                       buf[i] !== 0x20) { i++; }
            }
            const value = JSON.parse(buf.toString('utf8', vs, i));
            terminalEval.terminal(value, null);
        } else if (vb === OPEN_BRACE) {
            depth++;
            chainIdxStack[depth] = isMatch ? ci + 1 : -1;
            i++;
        } else if (vb === OPEN_BRACKET) {
            // arrays mid-chain: transparency not implemented in prototype -
            // treat as dead (dataset 1 has none on the chain)
            depth++;
            chainIdxStack[depth] = -1;
            i++;
        } else if (vb === QUOTE) {
            i++;
            while (i < len) {
                const c = buf[i];
                if (c === BACKSLASH) { i += 2; continue; }
                if (c === QUOTE) { i++; break; }
                i++;
            }
        } // scalars: main loop will skip them
        continue;
    }
    if (b === OPEN_BRACE || b === OPEN_BRACKET) {
        // shouldn't happen for values (handled above), defensive
        depth++;
        chainIdxStack[depth] = -1;
        i++;
        continue;
    }
    if (b === CLOSE_BRACE || b === CLOSE_BRACKET) {
        depth--;
        i++;
        continue;
    }
    i++;
}

const ms = Number(process.hrtime.bigint() - start) / 1e6;
console.log(JSON.stringify({ mode: 'hybrid', selector, count, ms: +ms.toFixed(1) }));
