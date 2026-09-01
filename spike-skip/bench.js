// Paired/interleaved go/no-go benchmark for issue #79's spike gate.
//
// Alternates baseline (yajs's real streaming engine, `fastPath: false`,
// tokenizing every byte) against the SKIP/PARSE/DESCEND prototype in
// `proto.js`, in ONE process, same pattern as this session's earlier
// tokenizer-slicing spike (exp/paired-e2e.js): interleaving means bursty
// unrelated load on this machine hits both sides roughly equally, and we
// report the MEDIAN of several process-CPU-time ratios rather than a
// single wall-clock sample (this session found single-run wall-clock
// benchmarks noisy under concurrent agent load).
//
// Usage: node bench.js <mode:ndjson|whole> <file> <needle> <selector> <pairs>
'use strict';
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { extractDescendant } = require('./proto');
const yajs = require(path.join(__dirname, '..', 'dist', 'main', 'main.js'));

const MODE = process.argv[2];
const FILE = process.argv[3];
const NEEDLE = Buffer.from(process.argv[4]);
const SELECTOR = process.argv[5];
const PAIRS = +(process.argv[6] || 5);

function cpuMs(c) { return (c.user + c.system) / 1e3; }

async function runBaseline() {
    return new Promise((resolve, reject) => {
        let count = 0;
        const c0 = process.cpuUsage();
        const w0 = process.hrtime.bigint();
        fs.createReadStream(FILE).pipe(yajs(SELECTOR)).
            on('data', () => count++).
            on('error', reject).
            on('end', () => {
                const c1 = process.cpuUsage(c0);
                resolve({ cpu: cpuMs(c1), wall: Number(process.hrtime.bigint() - w0) / 1e6, count });
            });
    });
}

async function runProtoNdjson() {
    return new Promise((resolve, reject) => {
        let count = 0;
        const c0 = process.cpuUsage();
        const w0 = process.hrtime.bigint();
        const rl = readline.createInterface({ input: fs.createReadStream(FILE), crlfDelay: Infinity });
        rl.on('line', (line) => {
            if (!line) return;
            try {
                count += extractDescendant(Buffer.from(line, 'utf8'), NEEDLE).length;
            } catch (e) { reject(e); }
        });
        rl.on('close', () => {
            const c1 = process.cpuUsage(c0);
            resolve({ cpu: cpuMs(c1), wall: Number(process.hrtime.bigint() - w0) / 1e6, count });
        });
    });
}

async function runProtoWhole() {
    const c0 = process.cpuUsage();
    const w0 = process.hrtime.bigint();
    const buf = fs.readFileSync(FILE);
    const count = extractDescendant(buf, NEEDLE).length;
    const c1 = process.cpuUsage(c0);
    return { cpu: cpuMs(c1), wall: Number(process.hrtime.bigint() - w0) / 1e6, count };
}

const runProto = MODE === 'ndjson' ? runProtoNdjson : runProtoWhole;

(async () => {
    console.log(`mode=${MODE} file=${FILE} selector=${SELECTOR} needle=${NEEDLE} pairs=${PAIRS}`);
    // Warmup both sides once (JIT warmup, page cache warmup - matches
    // paired-e2e.js's convention).
    const wb = await runBaseline();
    const wp = await runProto();
    console.log(`warmup: baseline count=${wb.count} cpu=${wb.cpu.toFixed(0)}ms | proto count=${wp.count} cpu=${wp.cpu.toFixed(0)}ms`);
    if (wb.count !== wp.count) {
        console.log(`WARNING: warmup match-count mismatch (baseline ${wb.count} vs proto ${wp.count}) - correctness issue, numbers below are not trustworthy`);
    }

    const ratios = [];
    const cpuRatios = [];
    for (let i = 0; i < PAIRS; i++) {
        const b = await runBaseline();
        const p = await runProto();
        const cpuRatio = b.cpu / p.cpu;
        const wallRatio = b.wall / p.wall;
        cpuRatios.push(cpuRatio);
        ratios.push(wallRatio);
        const mismatch = b.count !== p.count ? ` MISMATCH(base=${b.count},proto=${p.count})` : '';
        console.log(`pair ${i + 1}: base cpu ${b.cpu.toFixed(0)}ms (wall ${b.wall.toFixed(0)}ms)  proto cpu ${p.cpu.toFixed(0)}ms (wall ${p.wall.toFixed(0)}ms)  cpuRatio ${cpuRatio.toFixed(2)}x  wallRatio ${wallRatio.toFixed(2)}x${mismatch}`);
    }
    cpuRatios.sort((a, b) => a - b);
    ratios.sort((a, b) => a - b);
    const medCpu = cpuRatios[Math.floor(cpuRatios.length / 2)];
    const medWall = ratios[Math.floor(ratios.length / 2)];
    console.log(`RESULT ${MODE} ${SELECTOR}: median CPU-time speedup ${medCpu.toFixed(2)}x [${cpuRatios[0].toFixed(2)}..${cpuRatios[cpuRatios.length - 1].toFixed(2)}], median wall speedup ${medWall.toFixed(2)}x [${ratios[0].toFixed(2)}..${ratios[ratios.length - 1].toFixed(2)}]`);
})().catch((e) => { console.error(e); process.exit(1); });
