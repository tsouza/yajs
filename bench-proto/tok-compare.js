'use strict';
const fs = require('fs');
const { JsonSaxParser: Base } = require('../dist-baseline/main/lib/utils/JsonSaxParser.js');
const { JsonSaxParser: Proto } = require('../dist/main/lib/utils/JsonSaxParser.js');
const data = fs.readFileSync(process.argv[2]);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) { chunks.push(data.subarray(o, o + CHUNK)); }
const MB = data.length / (1024 * 1024);
function once(Parser) {
  let events = 0;
  const cb = {};
  for (const k of ['onBoolean', 'onColon', 'onComma', 'onEndArray', 'onEndObject', 'onNull', 'onNumber', 'onStartArray', 'onStartObject', 'onString']) { cb[k] = () => events++; }
  cb.onError = (e) => { throw e; };
  const t0 = process.hrtime.bigint();
  const p = new Parser(cb);
  for (const c of chunks) { p.parse(c); }
  p.finish();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, events };
}
const REPS = 6;
const res = { base: [], proto: [] };
for (let r = 0; r < REPS; r++) { // interleaved to cancel load drift
  res.base.push(once(Base).ms);
  res.proto.push(once(Proto).ms);
}
for (const k of ['base', 'proto']) {
  const best = Math.min(...res[k]);
  console.log(`${k}: best ${best.toFixed(0)} ms (${(MB / (best / 1000)).toFixed(1)} MB/s) all=[${res[k].map((t) => t.toFixed(0)).join(',')}]`);
}
