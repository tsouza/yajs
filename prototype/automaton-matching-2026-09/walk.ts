// Shared tree walker: drives a real StreamPosition/YAJSPath.match() pair and
// an AutomatonMatcher through the exact same sequence of position-stack
// push/pop events (object-slot enter/setKey/exit, array-slot enter/exit),
// mirroring what StreamContext does while streaming real SAX events. Used by
// both the differential-correctness harness and the benchmark, so both are
// exercising the two matchers identically.

import { StreamPosition } from '../../src/main/lib/context/StreamPosition';
import { YAJSPath } from '../../src/main/lib/path/YAJSPath';
import { AutomatonMatcher } from './automaton';
import { JsonTree } from './random-gen';

export interface EventSink {
    onEvent(realMatch: boolean, autoMatch: boolean, trace: string): void;
}

export function walkAndCompare(
    tree: JsonTree,
    pattern: YAJSPath,
    position: StreamPosition,
    automaton: AutomatonMatcher,
    sink: EventSink,
    trace: string = '$',
): void {
    if (Array.isArray(tree)) {
        position.stepIntoArray();
        const autoMatch0 = automaton.enterArraySlot();
        for (let idx = 0; idx < tree.length; idx++) {
            position.increaseArrayIndex();
            const realMatch = pattern.match(position);
            sink.onEvent(realMatch, autoMatch0, `${trace}[${idx}]`);
            walkAndCompare(tree[idx], pattern, position, automaton, sink, `${trace}[${idx}]`);
        }
        position.stepOutArray();
        automaton.exitArraySlot();
    } else if (tree !== null && typeof tree === 'object') {
        position.stepIntoObject();
        automaton.enterObjectSlot();
        for (const key of Object.keys(tree)) {
            position.updateObjectEntry(key);
            const autoMatch = automaton.setKey(key);
            const realMatch = pattern.match(position);
            sink.onEvent(realMatch, autoMatch, `${trace}.${key}`);
            walkAndCompare((tree as any)[key], pattern, position, automaton, sink, `${trace}.${key}`);
        }
        position.stepOutObject();
        automaton.exitObjectSlot();
    }
    // scalars: nothing further to push - the match test already happened at
    // the key/array-element level that produced this scalar.
}

// Plain (uncompared) drivers for benchmarking one matcher's raw per-event
// cost in isolation.
export function walkReal(tree: JsonTree, pattern: YAJSPath, position: StreamPosition, count: { n: number; matches: number }): void {
    if (Array.isArray(tree)) {
        position.stepIntoArray();
        for (const el of tree) {
            position.increaseArrayIndex();
            count.n++;
            if (pattern.match(position)) { count.matches++; }
            walkReal(el, pattern, position, count);
        }
        position.stepOutArray();
    } else if (tree !== null && typeof tree === 'object') {
        position.stepIntoObject();
        for (const key of Object.keys(tree)) {
            position.updateObjectEntry(key);
            count.n++;
            if (pattern.match(position)) { count.matches++; }
            walkReal((tree as any)[key], pattern, position, count);
        }
        position.stepOutObject();
    }
}

export function walkAutomaton(tree: JsonTree, automaton: AutomatonMatcher, count: { n: number; matches: number }): void {
    if (Array.isArray(tree)) {
        const m = automaton.enterArraySlot();
        for (const el of tree) {
            count.n++;
            if (m) { count.matches++; }
            walkAutomaton(el, automaton, count);
        }
        automaton.exitArraySlot();
    } else if (tree !== null && typeof tree === 'object') {
        automaton.enterObjectSlot();
        for (const key of Object.keys(tree)) {
            const m = automaton.setKey(key);
            count.n++;
            if (m) { count.matches++; }
            walkAutomaton((tree as any)[key], automaton, count);
        }
        automaton.exitObjectSlot();
    }
}
