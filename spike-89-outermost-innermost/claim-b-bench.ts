// Issue #89 Claim B: paired/interleaved benchmark of the "skip match() while
// an outermost capture is active" mechanism, following this session's
// established paired methodology (see exp/paired-e2e.js from the #76/#77
// spikes): alternate baseline-vs-prototype runs IN THE SAME PROCESS so any
// load burst from concurrent sibling agents on this machine hits both sides
// equally, report per-pair CPU-time ratios, take the median of N pairs, and
// flag the spread rather than trusting a single run.
//
// Both sides wire the SAME real, unmodified JsonSaxParser + YAJSPath.match()
// against the SAME input. The only difference is which StreamContext variant
// coordinates them: the real src/main/lib/context/StreamContext.ts (baseline,
// "match() runs on every event as today") vs. StreamContextSkipMatch.ts
// (prototype, "match() skipped while a dispatcher is already active" - see
// that file's header for exactly what it does and doesn't model).
//
// Run: tsx claim-b-bench.ts <ndjsonFile> [pairs=7]
import { readFileSync } from 'fs';
import { JsonSaxParser } from '../src/main/lib/utils/JsonSaxParser';
import { YAJSPath } from '../src/main/lib/path/YAJSPath';
import { StreamContext } from '../src/main/lib/context/StreamContext';
import { StreamContextSkipMatch } from './StreamContextSkipMatch';

// Mirrors yajs.ts's own createSaxParser() wiring (that function isn't
// exported, so this inlines the same small set of callbacks) - identical for
// both variants, only the StreamContext class + constructor args differ.
function makeEngine(makeContext: (onMatch: () => void) => any, buf: Buffer): number {
    let count = 0;
    const context = makeContext(() => { count++; });
    let strValue: any;
    const flushPendingString = () => {
        if (strValue != null) { context.onValue(strValue); strValue = null; }
    };
    const parser: any = new JsonSaxParser({
        onBoolean: (b: any) => { strValue = null; context.onValue(b); },
        onColon: () => { context.startObjectEntry(strValue); strValue = null; },
        onComma: () => flushPendingString(),
        onEndArray: () => { flushPendingString(); context.endArray(); },
        onEndObject: () => { flushPendingString(); context.endObject(); },
        onError: (err: Error) => { throw err; },
        onNull: () => { strValue = null; context.onValue(null); },
        onResync: () => { strValue = null; context.resyncAfterError(); },
        onNumber: (n: any) => { strValue = null; context.onValue(n); },
        onStartArray: () => { strValue = null; context.startArray(); },
        onStartObject: () => { strValue = null; context.startObject(); },
        onString: (s: any) => { flushPendingString(); strValue = s; },
        onValueBoundary: () => flushPendingString(),
    });
    parser.parse(buf);
    parser.finish();
    flushPendingString();
    return count;
}

function runOnce(kind: 'baseline' | 'skip', selector: string, buf: Buffer): { cpu: number; wall: number; count: number } {
    const path = YAJSPath.parse(selector);
    const w0 = process.hrtime.bigint();
    const c0 = process.cpuUsage();
    const count = makeEngine((onMatch) => {
        if (kind === 'baseline') {
            return new StreamContext(path, onMatch, false, (err: Error) => { throw err; });
        }
        return new StreamContextSkipMatch(path, onMatch, false, (err: Error) => { throw err; }, true);
    }, buf);
    const c1 = process.cpuUsage(c0);
    const wall = Number(process.hrtime.bigint() - w0) / 1e6;
    return { cpu: (c1.user + c1.system) / 1e3, wall, count };
}

function median(nums: number[]): number {
    const s = nums.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

function main() {
    const [file, pairsStr, selectorArg] = process.argv.slice(2);
    const pairs = parseInt(pairsStr || '7', 10);
    const selector = selectorArg || '$..plugins';
    const buf = readFileSync(file);

    // Warmup both sides once (JIT warmup, matches exp/paired-e2e.js's own
    // approach) - discarded, not counted in the reported ratios.
    runOnce('baseline', selector, buf);
    runOnce('skip', selector, buf);

    const ratios: number[] = [];
    const rows: string[] = [];
    for (let i = 0; i < pairs; i++) {
        const b = runOnce('baseline', selector, buf);
        const s = runOnce('skip', selector, buf);
        if (b.count !== s.count) {
            // Expected to differ for dense/sparse (the skip variant
            // under-counts vs baseline by design - see the file header: it
            // is not a correct general implementation, only a cost proxy).
            // Not an error; just informational.
        }
        const r = s.cpu / b.cpu;
        ratios.push(r);
        const row = `pair ${i + 1}: baseline cpu ${b.cpu.toFixed(1)}ms (wall ${b.wall.toFixed(1)}, matches ${b.count})` +
            `  skip cpu ${s.cpu.toFixed(1)}ms (wall ${s.wall.toFixed(1)}, matches ${s.count})  ratio(skip/base) ${r.toFixed(3)}`;
        rows.push(row);
        console.log(row);
    }
    const med = median(ratios);
    const sorted = ratios.slice().sort((a, b) => a - b);
    console.log(`\nselector=${selector} file=${file} pairs=${pairs}`);
    console.log(`cpu ratio skip/baseline: median ${med.toFixed(3)} [${sorted[0].toFixed(3)}..${sorted[sorted.length - 1].toFixed(3)}]`);
    console.log(`=> median speedup (baseline/skip): ${(1 / med).toFixed(3)}x`);
}

main();
