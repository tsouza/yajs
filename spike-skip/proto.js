// Go/no-go spike prototype for issue #79 (query-driven SKIP/PARSE/DESCEND
// architecture, rsonpath/JSONSki-style). THROWAWAY QUALITY - not meant to
// become production code. Implements exactly what the issue's own
// "Suggested next step" scoped:
//
//   1. head-skip: Buffer.indexOf('"key":') to jump straight to key
//      occurrences (Node's native memmem), for a `$..key`-shaped descendant
//      selector - this repo's actual bench selectors ($..plugins,
//      $..array.deep1) are exactly this shape.
//   2. tail-skip: a scalar quote/escape/depth-aware bracket-match to find
//      the exact byte span of the matched value (object/array/string/
//      number/bool/null), with ZERO per-byte tokenization/event dispatch.
//   3. JSON.parse() on the matched span to materialize the value.
//
// Deliberately NOT implemented (out of scope for a 2-day spike per the
// issue): full compiled automaton, DESCEND state tracking for definite
// paths, ancestor-key filters, project/drop-keys, triple-quote strings,
// NDJSON error-resync, chunk-spanning input (this operates on a single
// in-memory Buffer per call - see writeup for what a real streaming
// version would need to add).
'use strict';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

/**
 * Finds the exact end offset (exclusive) of the JSON value starting at
 * `start` in `buf`. Quote/escape-aware for strings, depth-counting for
 * objects/arrays, delimiter-scanning for bare scalars (number/bool/null).
 */
function scanValueEnd(buf, start) {
    const c = buf[start];
    if (c === QUOTE) {
        // Scalar string: scan to the matching unescaped quote.
        let i = start + 1;
        for (; i < buf.length; i++) {
            const b = buf[i];
            if (b === BACKSLASH) { i++; continue; }
            if (b === QUOTE) { return i + 1; }
        }
        throw new Error('unterminated string at ' + start);
    }
    if (c === OPEN_BRACE || c === OPEN_BRACKET) {
        // Object/array: depth-count, skipping over string contents (which
        // may themselves contain unbalanced brace/bracket bytes).
        let depth = 0;
        let inString = false;
        for (let i = start; i < buf.length; i++) {
            const b = buf[i];
            if (inString) {
                if (b === BACKSLASH) { i++; continue; }
                if (b === QUOTE) { inString = false; }
                continue;
            }
            if (b === QUOTE) { inString = true; continue; }
            if (b === OPEN_BRACE || b === OPEN_BRACKET) { depth++; continue; }
            if (b === CLOSE_BRACE || b === CLOSE_BRACKET) {
                depth--;
                if (depth === 0) { return i + 1; }
            }
        }
        throw new Error('unbalanced container at ' + start);
    }
    // Bare scalar (number/true/false/null): ends at the next structural
    // delimiter or whitespace.
    let i = start;
    for (; i < buf.length; i++) {
        const b = buf[i];
        if (b === 0x2c || b === 0x7d || b === 0x5d || b === 0x0a || b === 0x0d ||
            b === 0x20 || b === 0x09) {
            break;
        }
    }
    return i;
}

/**
 * Head-skip + tail-skip + JSON.parse for a `$..<key>`-shaped descendant
 * selector against a single self-contained Buffer (one NDJSON record, or
 * one whole document). Returns an array of matched values (JS-parsed) and
 * the number of candidate occurrences visited (including false positives
 * from indexOf matching the literal bytes inside an unrelated string,
 * which this scalar prototype does not fully rule out - see writeup).
 *
 * needle must be the literal `"key":` byte pattern (no whitespace after
 * the colon - true of all this repo's minified bench datasets).
 */
function extractDescendant(buf, needle) {
    const results = [];
    let from = 0;
    while (true) {
        const idx = buf.indexOf(needle, from);
        if (idx === -1) { break; }
        const valueStart = idx + needle.length;
        const valueEnd = scanValueEnd(buf, valueStart);
        const span = buf.subarray(valueStart, valueEnd).toString('utf8');
        const parsed = JSON.parse(span);
        // Match yajs's own emission semantics (verified empirically against
        // the real engine, see check-correctness.js): a matched value that
        // is itself a JSON array is NOT emitted as one event - each element
        // is emitted as its own match (yajs treats an array node as an
        // implicit fan-out, one 'data' event per element, not per matched
        // key). A matched scalar/object is emitted as-is.
        if (Array.isArray(parsed)) {
            for (const el of parsed) { results.push(el); }
        } else {
            results.push(parsed);
        }
        from = valueEnd;
    }
    return results;
}

module.exports = { extractDescendant, scanValueEnd };
