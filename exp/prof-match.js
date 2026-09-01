// Single-rep tokenize+match run for --prof / heap sampling.
'use strict';
const fs = require('fs');
const { JsonSaxParser } = require('../dist/main/lib/utils/JsonSaxParser.js');
const { StreamContext } = require('../dist/main/lib/context/StreamContext.js');
const { YAJSPath } = require('../dist/main/lib/path/YAJSPath.js');

const file = process.argv[2];
const data = fs.readFileSync(file);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) {
    chunks.push(data.subarray(o, Math.min(o + CHUNK, data.length)));
}

let matches = 0;
const yajsPath = YAJSPath.parse('$.field2.nested');
const context = new StreamContext(yajsPath, () => matches++, false,
    (err) => { throw err; });
let strValue = null;
const flush = () => {
    if (strValue != null) { context.onValue(strValue); strValue = null; }
};
const p = new JsonSaxParser({
    onBoolean: (b) => { strValue = null; context.onValue(b); },
    onColon: () => { context.startObjectEntry(strValue); strValue = null; },
    onComma: () => flush(),
    onEndArray: () => { flush(); context.endArray(); },
    onEndObject: () => { flush(); context.endObject(); },
    onError: (e) => { throw e; },
    onNull: () => { strValue = null; context.onValue(null); },
    onNumber: (n) => { strValue = null; context.onValue(n); },
    onStartArray: () => { strValue = null; context.startArray(); },
    onStartObject: () => { strValue = null; context.startObject(); },
    onString: (s) => { flush(); strValue = s; },
    onValueBoundary: () => flush(),
});
const t0 = process.hrtime.bigint();
for (const c of chunks) { p.parse(c); }
p.finish();
flush();
console.log(JSON.stringify({ matches, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
