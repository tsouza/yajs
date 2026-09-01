// Fallback-decision prototype: when a line fails JSON.parse, a structural
// scan of that line (only failing lines pay this) classifies what to do:
//   'incomplete'   - unbalanced at EOL: a document continuing on the next
//                    line (pretty-printed JSON) -> accumulate lines and
//                    retry (still fast path)
//   'triple-quote' - the """ extension: JSON.parse can never take it ->
//                    hand the stream (from this record) to the SAX engine
//   'multi-value'  - several whitespace-separated top-level values on one
//                    line -> split at the balance points and parse each
//                    (or SAX fallback; both preserve semantics)
//   'malformed'    - balanced-looking but invalid: report an error and
//                    resync at the next line (issue #50), reproducing the
//                    SAX error by replaying the bad record through a
//                    throwaway JsonSaxParser with the record's stream
//                    offset for exact message/position parity
'use strict';

function classifyFailedLine(line) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    let sawValue = false;
    let scalarActive = false; // currently inside a depth-0 bare scalar token
    let multi = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
            if (esc) { esc = false; }
            else if (c === '\\') { esc = true; }
            else if (c === '"') {
                // three consecutive quotes opening a string -> extension
                if (line[i + 1] === '"' && i > 0 && line[i - 1] === '"') { return 'triple-quote'; }
                inStr = false;
            }
            continue;
        }
        if (c === '"') {
            if (depth === 0 && sawValue) { multi = true; }
            inStr = true;
            sawValue = true;
            scalarActive = false;
        } else if (c === '{' || c === '[') {
            if (depth === 0 && sawValue) { multi = true; }
            depth++;
            sawValue = true;
            scalarActive = false;
        } else if (c === '}' || c === ']') {
            depth--;
        } else if (depth === 0) {
            if (/\s/.test(c)) {
                scalarActive = false;
            } else if (!sawValue) {
                sawValue = true;
                scalarActive = true;
            } else if (!scalarActive) {
                multi = true;
            }
        }
    }
    if (inStr || depth > 0) { return 'incomplete'; }
    if (multi) { return 'multi-value'; }
    return 'malformed';
}

module.exports = { classifyFailedLine };

if (require.main === module) {
    const cases = [
        ['{oops}', 'malformed'],
        ['{"a":1,}', 'malformed'],
        ['{"a":', 'incomplete'],
        ['{', 'incomplete'],
        ['{"a": "unterminated', 'incomplete'],
        ['{"q":"""He said "hi" to me"""}', 'triple-quote'],
        ['{"a":1} {"a":2}', 'multi-value'],
        ['1 2', 'multi-value'],
        ['"a" "b"', 'multi-value'],
        ['{"a":[1,2]', 'incomplete'],
        ['{"a":1}]', 'malformed'],
    ];
    let ok = true;
    for (const [line, expect] of cases) {
        const got = classifyFailedLine(line);
        if (got !== expect) { ok = false; }
        console.log(`${got === expect ? 'OK  ' : 'FAIL'} ${JSON.stringify(line)} -> ${got} (expect ${expect})`);
    }
    process.exit(ok ? 0 : 1);
}
