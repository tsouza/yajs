// Issue #80: real end-to-end paired/interleaved benchmark, following this
// session's established methodology (see spike-89-outermost-innermost/
// claim-b-bench.ts, PR #91's Claim B harness for issue #89): alternate
// baseline-vs-prototype runs IN THE SAME PROCESS so any load burst from
// concurrent sibling agents on this machine hits both sides equally, report
// per-pair CPU-time ratios, take the median of N pairs, and show the spread
// rather than trusting a single run.
//
// Both sides wire the SAME real, unmodified JsonSaxParser against the SAME
// real input (a real prefix of src/bench/data/data-2.ndjson.gz - the actual
// Dataset 2 elasticsearch monitoring dump benchmark.md uses, decompressed
// once up front, not synthetic). The only difference is which coordinator
// drives it: the real src/main/lib/context/StreamContext.ts (baseline) vs.
// StreamContextAutomaton.ts (prototype - the real StreamContext with only
// the match() call swapped for the automaton - see that file's header).
//
// Run: npx tsx e2e-bench.ts <ndjsonFile> [pairs=7] [selector=$..plugins]
import { readFileSync } from 'fs';
import { JsonSaxParser } from '../../src/main/lib/utils/JsonSaxParser';
import { YAJSPath } from '../../src/main/lib/path/YAJSPath';
import { StreamContext } from '../../src/main/lib/context/StreamContext';
import { StreamContextAutomaton } from './StreamContextAutomaton';
import { compile } from './automaton';
import { parseSelector } from './selector';

// Mirrors yajs.ts's own createSaxParser() wiring (not exported) - identical
// for both variants, only the coordinator class + constructor args differ.
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

function runOnce(kind: 'baseline' | 'automaton', selector: string, buf: Buffer): { cpu: number; wall: number; count: number } {
    const path = YAJSPath.parse(selector);
    const steps = parseSelector(selector);
    const automaton = compile(steps);
    const w0 = process.hrtime.bigint();
    const c0 = process.cpuUsage();
    const count = makeEngine((onMatch) => {
        if (kind === 'baseline') {
            return new StreamContext(path, onMatch, false, (err: Error) => { throw err; });
        }
        return new StreamContextAutomaton(path, automaton, onMatch, false, (err: Error) => { throw err; });
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
    console.log(`file=${file} (${(buf.length / 1e6).toFixed(1)}MB) selector=${selector} pairs=${pairs}`);

    // Warmup both sides once (JIT + automaton transition-table warmup) -
    // discarded, not counted in the reported ratios.
    runOnce('baseline', selector, buf);
    runOnce('automaton', selector, buf);

    const ratios: number[] = [];
    for (let i = 0; i < pairs; i++) {
        const b = runOnce('baseline', selector, buf);
        const a = runOnce('automaton', selector, buf);
        if (b.count !== a.count) {
            console.log(`  ** MATCH COUNT MISMATCH ** baseline=${b.count} automaton=${a.count}`);
        }
        const r = a.cpu / b.cpu;
        ratios.push(r);
        console.log(`pair ${i + 1}: baseline cpu ${b.cpu.toFixed(1)}ms (wall ${b.wall.toFixed(1)}, matches ${b.count})` +
            `  automaton cpu ${a.cpu.toFixed(1)}ms (wall ${a.wall.toFixed(1)}, matches ${a.count})  ratio(automaton/base) ${r.toFixed(3)}`);
    }
    const med = median(ratios);
    const sorted = ratios.slice().sort((x, y) => x - y);
    console.log(`\nselector=${selector} file=${file} pairs=${pairs}`);
    console.log(`cpu ratio automaton/baseline: median ${med.toFixed(3)} [${sorted[0].toFixed(3)}..${sorted[sorted.length - 1].toFixed(3)}]`);
    console.log(`=> median END-TO-END speedup (baseline/automaton): ${(1 / med).toFixed(3)}x`);
}

main();
