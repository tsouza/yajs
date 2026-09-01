// Summarize final-bench.out: per-pair ratios (baseline / fast, computed
// within each rep's adjacent runs), median + min/max spread per group+mode.
'use strict';
const lines = require('fs').readFileSync(process.argv[2], 'utf8').split('\n');
const rows = lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

const groups = {};
for (const r of rows) {
    const g = (groups[r.group] = groups[r.group] || {});
    const rep = (g[r.rep] = g[r.rep] || {});
    rep[r.mode] = r.ms;
}

function median(a) {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

for (const [gname, reps] of Object.entries(groups)) {
    const modes = new Set();
    for (const rep of Object.values(reps)) {
        for (const m of Object.keys(rep)) { if (m !== 'real') { modes.add(m); } }
    }
    for (const mode of modes) {
        const ratios = [];
        const baseMs = [];
        const fastMs = [];
        for (const rep of Object.values(reps)) {
            if (rep.real && rep[mode]) {
                ratios.push(rep.real / rep[mode]);
                baseMs.push(rep.real);
                fastMs.push(rep[mode]);
            }
        }
        const spread = (Math.max(...ratios) - Math.min(...ratios)) / median(ratios);
        console.log(`${gname} real-vs-${mode}: median ratio ${median(ratios).toFixed(2)}x ` +
            `(pairs: ${ratios.map((r) => r.toFixed(2)).join(', ')}) ` +
            `spread ${(spread * 100).toFixed(0)}%${spread > 0.25 ? '  ** HIGH SPREAD **' : ''}\n` +
            `  real median ${median(baseMs).toFixed(0)}ms, ${mode} median ${median(fastMs).toFixed(0)}ms`);
    }
}
