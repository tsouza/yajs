'use strict';
// Micro: materialize an N-byte ASCII span from a Buffer, 4 strategies.
const buf = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789'.repeat(10));
const N = +(process.argv[2] || 6);
const ITER = 5e6;
function time(name, fn) {
  fn(1e5); // warmup
  const c0 = process.cpuUsage();
  const out = fn(ITER);
  const cu = process.cpuUsage(c0);
  console.log(`${name}: ${(((cu.user + cu.system) / 1e3) / ITER * 1e6).toFixed(1)} ns/op (check ${out})`);
}
time('latin1Slice', (it) => {
  let acc = 0;
  for (let k = 0; k < it; k++) {
    const s = buf.latin1Slice(0, N);
    acc += s.length;
  }
  return acc;
});
time('toString-latin1', (it) => {
  let acc = 0;
  for (let k = 0; k < it; k++) {
    const s = buf.toString('latin1', 0, N);
    acc += s.length;
  }
  return acc;
});
time('utf8Slice', (it) => {
  let acc = 0;
  for (let k = 0; k < it; k++) {
    const s = buf.utf8Slice(0, N);
    acc += s.length;
  }
  return acc;
});
time('fromCharCode-loop', (it) => {
  let acc = 0;
  for (let k = 0; k < it; k++) {
    let s = '';
    for (let i = 0; i < N; i++) { s += String.fromCharCode(buf[i]); }
    acc += s.length;
  }
  return acc;
});
