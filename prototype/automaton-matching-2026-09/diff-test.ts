// Differential correctness harness for issue #80's scoped investigation.
//
// Compares the automaton prototype's match decisions against the real
// YAJSPath.match()/StreamPosition backward-walk (the actual engine under
// investigation), across:
//   1. Selector strings pulled from the existing test corpus
//      (src/test/02-path.ts, src/test/03-yajs.ts) that fall within our
//      supported subset (see selector.ts's header for what's excluded and
//      why), each run against a handful of hand-picked documents plus
//      random trees.
//   2. Randomized selector/document generation (random-gen.ts), the
//      load-bearing verification step per the issue's own instructions.
//
// Run: npx tsx prototype/automaton-matching-2026-09/diff-test.ts
// Env: DIFF_RANDOM_CASES (default 4000), DIFF_TREES_PER_SELECTOR (default 8),
//      DIFF_SEED (default 1)

import * as fs from 'fs';
import * as path from 'path';
import { StreamPosition } from '../../src/main/lib/context/StreamPosition';
import { compile, AutomatonMatcher } from './automaton';
import { makeRng, randomSteps, randomTree, JsonTree } from './random-gen';
import { buildRealPath, isSupportedSelector, parseSelector, Step, toSelectorString } from './selector';
import { walkAndCompare } from './walk';

interface Mismatch {
    selector: string;
    trace: string;
    real: boolean;
    auto: boolean;
    treeSnippet: string;
}

class Recorder {
    total = 0;
    mismatches: Mismatch[] = [];
    matchesFound = 0;
    constructor(private selector: string, private tree: JsonTree, private cap: number) {}
    onEvent(real: boolean, auto: boolean, trace: string): void {
        this.total++;
        if (real) { this.matchesFound++; }
        if (real !== auto && this.mismatches.length < this.cap) {
            this.mismatches.push({
                selector: this.selector,
                trace,
                real,
                auto,
                treeSnippet: JSON.stringify(this.tree).slice(0, 300),
            });
        }
    }
}

function runOneCase(steps: Step[], tree: JsonTree, capPerCase: number): Recorder {
    const selectorStr = toSelectorString(steps);
    const realPath = buildRealPath(steps);
    const position = new StreamPosition(false, !realPath.definite);
    const automaton = new AutomatonMatcher(compile(steps));
    const recorder = new Recorder(selectorStr, tree, capPerCase);
    walkAndCompare(tree, realPath, position, automaton, recorder);
    return recorder;
}

function loadCorpusSelectors(): string[] {
    const testDir = path.join(__dirname, '../../src/test');
    const files = ['02-path.ts', '03-yajs.ts'];
    const found = new Set<string>();
    for (const f of files) {
        const text = fs.readFileSync(path.join(testDir, f), 'utf8');
        const re = /'(\$[^']*)'/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
            found.add(m[1]);
        }
    }
    return [...found];
}

function main(): void {
    const randomCases = Number(process.env.DIFF_RANDOM_CASES || 4000);
    const treesPerSelector = Number(process.env.DIFF_TREES_PER_SELECTOR || 8);
    const seed = Number(process.env.DIFF_SEED || 1);
    const rng = makeRng(seed);

    let totalEvents = 0;
    let totalMatches = 0;
    const allMismatches: Mismatch[] = [];
    let casesRun = 0;
    let corpusSupported = 0;
    let corpusSkipped = 0;

    // Leg 1: existing test-suite corpus selectors (filtered to our subset),
    // each against a handful of hand-picked + random documents.
    const corpus = loadCorpusSelectors();
    const handPickedTrees: JsonTree[] = [
        { a: { b: { c: 1 } } },
        { a: [{ c: { a: { x: 1 } } }] },
        { a: { c: { a: { x: 1 } } } },
        { m: [[{ a: 1 }]] },
        { x: { deep: 1 } },
        [1, 2, 3],
        { arr: [1, 2, 3] },
        { plugins: [{ name: 'p1' }, { name: 'p2' }] },
        { nodes: { n1: { plugins: [{ v: 1 }] }, n2: { plugins: [{ v: 2 }] } } },
        { a: { b: 1 }, x: { b: 2 } },
    ];
    for (const sel of corpus) {
        if (!isSupportedSelector(sel)) {
            corpusSkipped++;
            continue;
        }
        corpusSupported++;
        let steps: Step[];
        try {
            steps = parseSelector(sel);
        } catch {
            corpusSkipped++;
            corpusSupported--;
            continue;
        }
        const trees = [...handPickedTrees];
        for (let i = 0; i < 6; i++) {
            trees.push(randomTree(rng, 6, 3));
        }
        for (const tree of trees) {
            const rec = runOneCase(steps, tree, 5);
            totalEvents += rec.total;
            totalMatches += rec.matchesFound;
            allMismatches.push(...rec.mismatches);
            casesRun++;
        }
    }

    // Leg 2: randomized selector/document generation - the load-bearing leg.
    for (let i = 0; i < randomCases; i++) {
        const steps = randomSteps(rng, 6);
        for (let t = 0; t < treesPerSelector; t++) {
            const tree = randomTree(rng, 7, 3);
            const rec = runOneCase(steps, tree, 3);
            totalEvents += rec.total;
            totalMatches += rec.matchesFound;
            allMismatches.push(...rec.mismatches);
            casesRun++;
        }
    }

    console.log(`Corpus selectors found: ${corpus.length} (supported subset: ${corpusSupported}, skipped as out-of-scope: ${corpusSkipped})`);
    console.log(`Total (selector, tree) cases run: ${casesRun}`);
    console.log(`Total position events compared: ${totalEvents}`);
    console.log(`Total real-matcher matches observed: ${totalMatches}`);
    console.log(`Mismatches: ${allMismatches.length}`);
    if (allMismatches.length > 0) {
        console.log('First mismatches:');
        for (const m of allMismatches.slice(0, 30)) {
            console.log(`  selector=${m.selector} trace=${m.trace} real=${m.real} auto=${m.auto} tree=${m.treeSnippet}`);
        }
        process.exitCode = 1;
    } else {
        console.log('OK: automaton matched the real backward-walk matcher on every event across all cases.');
    }
}

main();
