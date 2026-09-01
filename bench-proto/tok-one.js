'use strict';
// Usage: node tok-one.js <base|proto> <file> [reps]
const fs = require('fs');
const which = process.argv[2];
const { JsonSaxParser } = require(which === 'base' ?
  '../dist-baseline/main/lib/utils/JsonSaxParser.js' :
  '../dist/main/lib/utils/JsonSaxParser.js');
const data = fs.readFileSync(process.argv[3]);
const CHUNK = 64 * 1024;
const chunks = [];
for (let o = 0; o < data.length; o += CHUNK) { chunks.push(data.subarray(o, o + CHUNK)); }
const MB = data.length / (1024 * 1024);
const REPS = +(process.argv[4] || 4);
const times = [];
for (let r = 0; r < REPS; r++) {
  let events = 0;
  const cb = {};
  for (const k of ['onBoolean', 'onColon', 'onComma', 'onEndArray', 'onEndObject', 'onNull', 'onNumber', 'onStartArray', 'onStartObject', 'onString']) { cb[k] = () => events++; }
  cb.onError = (e) => { throw e; };
  const c0 = process.cpuUsage();
  const p = new JsonSaxParser(cb);
  for (const c of chunks) { p.parse(c); }
  p.finish();
  const cu = process.cpuUsage(c0);
  times.push((cu.user + cu.system) / 1e3); // CPU ms, robust to load
}
const best = Math.min(...times);
console.log(`${which}: best ${best.toFixed(0)} ms (${(MB / (best / 1000)).toFixed(1)} MB/s) all=[${times.map((t) => t.toFixed(0)).join(',')}]`);
