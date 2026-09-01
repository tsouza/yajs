// Issue #89 Claim B: synthetic NDJSON generator modeling the repo's real
// benchmark shape. benchmark.md's Dataset 2/3 use selector `$..plugins`
// against ndjson/json records - that's the real-world shape #89's rationale
// is about (self-nesting containers: comment threads, category trees,
// plugin dependency trees), so this generator produces `plugins`-keyed
// records shaped the same way, at three profiles:
//
//   dense     - EVERY record self-nests `plugins` to a fixed depth (models
//               "self-nesting is the norm" - the ceiling of any win).
//   sparse    - only a small fraction of records self-nest at all, modeling
//               "self-nesting is rare in typical real-world data", which the
//               task explicitly asks to check honestly.
//   disjoint  - records have several SIBLING (non-nested) `plugins` keys
//               instead of nested ones, to confirm the skip mechanism isn't
//               accidentally cheating on a shape it shouldn't help on.
//
// Run: tsx gen-data.ts <profile> <recordCount> <outFile>
import { writeFileSync } from 'fs';

let seed = 1234567;
function rnd() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}
function rndInt(n: number) { return Math.floor(rnd() * n); }

function leafPlugin(id: number) {
    return { name: `plugin-${id}`, version: `${1 + rndInt(9)}.${rndInt(20)}.${rndInt(20)}`, enabled: rnd() < 0.5 };
}

// A chain of `depth` levels of self-nesting `plugins` (each level itself
// looks like a real plugin entry with siblings `name`/`version`, mirroring
// how a real plugin-dependency-tree or comment-thread record would actually
// be shaped - not a bare `{plugins:{plugins:...}}` with nothing else).
function nestingChain(depth: number, id: number): any {
    if (depth <= 0) { return leafPlugin(id); }
    return {
        name: `plugin-${id}`,
        version: `${1 + rndInt(9)}.${rndInt(20)}.${rndInt(20)}`,
        enabled: rnd() < 0.5,
        plugins: nestingChain(depth - 1, id + 1),
    };
}

function makeRecord(profile: string, depth: number, idx: number): any {
    const base = {
        id: idx,
        field2: { nested: `value-${idx}` },
        timestamp: 1700000000 + idx,
        source: `svc-${rndInt(20)}`,
    };
    if (profile === 'dense') {
        return { ...base, plugins: nestingChain(depth, idx * 100) };
    }
    if (profile === 'sparse') {
        // Only ~5% of records self-nest at all; the rest are a single,
        // ordinary (non-nested) `plugins` entry - modeling "self-nesting is
        // rare" for the honesty check the task asks for.
        const nests = rnd() < 0.05;
        return { ...base, plugins: nests ? nestingChain(depth, idx * 100) : leafPlugin(idx * 100) };
    }
    if (profile === 'disjoint') {
        // Several sibling (non-nested) plugins keys under unrelated parents -
        // no self-nesting anywhere, so the skip mechanism should never
        // trigger and must show ~1.0x here.
        return {
            ...base,
            appA: { plugins: leafPlugin(idx * 10 + 1) },
            appB: { plugins: leafPlugin(idx * 10 + 2) },
            appC: { plugins: leafPlugin(idx * 10 + 3) },
        };
    }
    throw new Error(`unknown profile ${profile}`);
}

function main() {
    const [profile, countStr, outFile, depthStr] = process.argv.slice(2);
    const count = parseInt(countStr, 10);
    const depth = parseInt(depthStr || '4', 10);
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
        lines.push(JSON.stringify(makeRecord(profile, depth, i)));
    }
    writeFileSync(outFile, lines.join('\n') + '\n');
    console.log(`wrote ${count} records (profile=${profile}, depth=${depth}) to ${outFile}`);
}

main();
