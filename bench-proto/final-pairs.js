'use strict';
// Final paired-interleaved benchmark: runs baseline and prototype in
// ADJACENT PAIRS (base, proto, base, proto, ...) so load bursts on a busy
// box hit both sides roughly equally. Reports each pair's ratio
// (base/proto; > 1 means prototype faster), the MEDIAN ratio, and the
// spread. Each side of a pair is a fresh child process.
//
// Usage: node final-pairs.js <data-file> [pairs] [--skip-e2e]
// Tokenizer pairs use --single-threaded --single-threaded-gc + CPU time
// (robust to scheduler contention AND to parallel-GC-thread CPU
// accounting); e2e pairs use a default node process and report both wall
// and CPU ratios.
const { execFileSync } = require('child_process');
const path = require('path');
const here = __dirname;
const file = process.argv[2];
const PAIRS = +(process.argv[3] || 6);
const skipE2e = process.argv.includes('--skip-e2e');

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function summarize(label, ratios) {
  const spreadPct = (Math.max(...ratios) / Math.min(...ratios) - 1) * 100;
  console.log(`${label}: per-pair ratios (base/proto, >1 = proto faster) = [${ratios.map((r) => r.toFixed(3)).join(', ')}]`);
  console.log(`${label}: MEDIAN ratio ${median(ratios).toFixed(3)}  spread ${spreadPct.toFixed(1)}%${spreadPct > 25 ? '  ** SPREAD > 25%: treat with caution **' : ''}`);
}

// ---- tokenizer ----
function tokOnce(which) {
  const out = execFileSync(process.execPath,
    ['--single-threaded', '--single-threaded-gc', path.join(here, 'tok-one.js'), which, file, '4'],
    { encoding: 'utf8' });
  process.stdout.write('  ' + out);
  return +out.match(/best (\d+) ms/)[1];
}
console.log(`== tokenize-noop, ${PAIRS} interleaved pairs, best-of-4 CPU-ms per side ==`);
const tokRatios = [];
for (let p = 0; p < PAIRS; p++) {
  const b = tokOnce('base');
  const q = tokOnce('proto');
  tokRatios.push(b / q);
}
summarize('tokenize-noop', tokRatios);

// ---- end-to-end ----
if (!skipE2e) {
  function e2eOnce(which) {
    const out = execFileSync(process.execPath, [path.join(here, 'e2e-one.js'), which, file], { encoding: 'utf8' });
    process.stdout.write('  ' + out);
    return JSON.parse(out);
  }
  console.log(`== e2e ($.field2.nested), ${PAIRS} interleaved pairs, single run per side ==`);
  const wallRatios = [];
  const cpuRatios = [];
  for (let p = 0; p < PAIRS; p++) {
    const b = e2eOnce('base');
    const q = e2eOnce('proto');
    wallRatios.push(b.wallMs / q.wallMs);
    cpuRatios.push(b.cpuMs / q.cpuMs);
  }
  summarize('e2e wall', wallRatios);
  summarize('e2e cpu', cpuRatios);
}
