// Matching-layer-only benchmark for issue #80's scoped investigation:
// measures the automaton prototype against the real YAJSPath.match()
// backward-walk on REAL data (a prefix of src/bench/data/data-2.ndjson.gz -
// the same elasticsearch monitoring dump benchmark.md's Dataset 2 uses,
// with `$..plugins` as the selection path), isolating the pattern-matching
// decision itself from tokenizer/parse cost (both matchers are driven by
// walking the SAME already-parsed JS object trees - see walk.ts).
//
// Per the issue's own instructions: measure gain on `..`/wildcard-heavy
// selectors (this dataset's `$..plugins`), NOT a definite chain like
// Dataset 1's `$.field2.nested` (included below only as an explicit
// contrast, to show the gain is selector-shape-dependent, not a free win
// everywhere).
//
// Run: npx tsx prototype/automaton-matching-2026-09/bench.ts
// Env: BENCH_LINES (default 20000), BENCH_REPEATS (default 5)

import { createReadStream } from 'fs';
import * as path from 'path';
import { createGunzip } from 'zlib';
import * as readline from 'readline';
import { StreamPosition } from '../../src/main/lib/context/StreamPosition';
import { compile, AutomatonMatcher } from './automaton';
import { buildRealPath, parseSelector } from './selector';
import { walkAutomaton, walkReal } from './walk';

const LINES = Number(process.env.BENCH_LINES || 20000);
const REPEATS = Number(process.env.BENCH_REPEATS || 5);

async function loadTrees(file: string, limit: number): Promise<any[]> {
    const trees: any[] = [];
    const stream = createReadStream(path.join(__dirname, '../../src/bench/data', file)).pipe(createGunzip());
    const rl = readline.createInterface({ input: stream });
    for await (const line of rl) {
        if (!line.trim()) { continue; }
        trees.push(JSON.parse(line));
        if (trees.length >= limit) {
            rl.close();
            (stream as any).destroy();
            break;
        }
    }
    return trees;
}

function benchSelector(name: string, selectorStr: string, trees: any[]): void {
    const steps = parseSelector(selectorStr);
    const realPath = buildRealPath(steps);
    const automaton = compile(steps);

    // Warm-up (JIT + automaton transition-table warm-up) - not timed.
    for (const tree of trees) {
        const position = new StreamPosition(false, !realPath.definite);
        walkReal(tree, realPath, position, { n: 0, matches: 0 });
        const m = new AutomatonMatcher(automaton);
        walkAutomaton(tree, m, { n: 0, matches: 0 });
    }

    const realTimes: number[] = [];
    const autoTimes: number[] = [];
    let realEvents = 0;
    let realMatches = 0;
    let autoEvents = 0;
    let autoMatches = 0;

    for (let r = 0; r < REPEATS; r++) {
        const rc = { n: 0, matches: 0 };
        const t0 = process.hrtime.bigint();
        for (const tree of trees) {
            const position = new StreamPosition(false, !realPath.definite);
            walkReal(tree, realPath, position, rc);
        }
        const t1 = process.hrtime.bigint();
        realTimes.push(Number(t1 - t0) / 1e6);
        realEvents = rc.n;
        realMatches = rc.matches;

        const ac = { n: 0, matches: 0 };
        const t2 = process.hrtime.bigint();
        for (const tree of trees) {
            const m = new AutomatonMatcher(automaton);
            walkAutomaton(tree, m, ac);
        }
        const t3 = process.hrtime.bigint();
        autoTimes.push(Number(t3 - t2) / 1e6);
        autoEvents = ac.n;
        autoMatches = ac.matches;
    }

    realTimes.sort((a, b) => a - b);
    autoTimes.sort((a, b) => a - b);
    const realMedian = realTimes[Math.floor(realTimes.length / 2)];
    const autoMedian = autoTimes[Math.floor(autoTimes.length / 2)];

    console.log(`\n=== ${name}: ${selectorStr} ===`);
    console.log(`documents: ${trees.length}, position-events per run: ${realEvents} (real) / ${autoEvents} (automaton)`);
    console.log(`matches found: ${realMatches} (real) / ${autoMatches} (automaton) ${realMatches === autoMatches ? '[agree]' : '[**DISAGREE**]'}`);
    console.log(`real backward-walk:  median ${realMedian.toFixed(2)}ms  (all: ${realTimes.map((t) => t.toFixed(1)).join(', ')})`);
    console.log(`automaton:           median ${autoMedian.toFixed(2)}ms  (all: ${autoTimes.map((t) => t.toFixed(1)).join(', ')})`);
    console.log(`speedup (median real / median automaton): ${(realMedian / autoMedian).toFixed(2)}x`);
    console.log(`real events/sec:      ${(realEvents / (realMedian / 1000)).toFixed(0)}`);
    console.log(`automaton events/sec: ${(autoEvents / (autoMedian / 1000)).toFixed(0)}`);
}

async function main(): Promise<void> {
    console.log(`Loading up to ${LINES} lines from data-2.ndjson.gz (Dataset 2 - elasticsearch monitoring dump, benchmark.md's own '$..plugins' shape)...`);
    const dataset2 = await loadTrees('data-2.ndjson.gz', LINES);
    console.log(`Loaded ${dataset2.length} documents from Dataset 2.`);

    console.log(`Loading up to ${LINES} lines from data-1.ndjson.gz (Dataset 1 - definite-chain shape, included ONLY as a contrast - the issue explicitly says this is the WRONG shape to expect a gain on)...`);
    const dataset1 = await loadTrees('data-1.ndjson.gz', LINES);
    console.log(`Loaded ${dataset1.length} documents from Dataset 1.`);

    // Primary target: `..`/wildcard-heavy, matching benchmark.md's own
    // Dataset 2 selection path exactly.
    benchSelector('Dataset 2 (descendant + key)', '$..plugins', dataset2);

    // A heavier wildcard-vs-descendant combination on the same real data,
    // to see whether the gain grows with pattern complexity.
    benchSelector('Dataset 2 (descendant + wildcard)', '$.._source..plugins..name', dataset2);
    benchSelector('Dataset 2 (bare descendant-wildcard, matches nearly everything)', '$..*', dataset2);

    // Contrast: Dataset 1's own definite-chain selector - the issue's own
    // explicit "wrong shape to benchmark this on" example, included to make
    // the shape-dependency concrete rather than asserted.
    benchSelector('Dataset 1 (definite chain - contrast only)', '$.field2.nested', dataset1);

    console.log('\nDone.');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
