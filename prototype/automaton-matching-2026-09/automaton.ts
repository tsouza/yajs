// Prototype automaton (NFA -> lazily-determinized DFA) compiler + runtime
// matcher for issue #80's scoped investigation.
//
// Design summary (see the issue #80 comment / PR description for the full
// writeup):
//
// - The pattern is compiled into a small nondeterministic thread model over
//   "position events" (KEY(name) | ARRAY), one event per position-stack
//   depth. Descendant's "search arbitrarily far back, backtrack to a
//   farther ancestor if the nearer one doesn't pan out" (issue #45) falls
//   out of ordinary NFA subset construction for free: a Kleene-star-style
//   self-loop thread and a "try consuming now" thread are simply both kept
//   alive simultaneously, so every candidate ancestor is implicitly explored
//   in parallel instead of one at a time with a recursion-based backtrack.
// - Wildcard-vs-array ambiguity (README/ARCHITECTURE.md's "the engine now
//   tries both readings") is likewise just two NFA transitions on the same
//   ARRAY symbol from the same state - no backtracking construct needed.
// - Determinization is LAZY (states/transitions are discovered and memoized
//   on demand, not eagerly enumerated over the full alphabet) - this keeps
//   compilation cheap and is how production regex engines typically build a
//   "lazy DFA" too. A real production version would additionally bucket
//   KEY events into "one of the pattern's own literal keys" vs a single
//   fallback "any other key" class (bounding table size independent of
//   document key cardinality, as rsonpath does) - this prototype instead
//   memoizes per exact key string seen, which is simpler but means the
//   transition table grows with the number of DISTINCT keys the input
//   actually contains rather than staying bounded by pattern size alone.
//   Called out explicitly as a scope gap in the writeup.
// - Filters ([key] - single-key-list OR semantics, matching
//   AbstractFilteredOperator/ScriptFilterHelper's non-boolean-expression
//   fallback) depend on which ancestor keys have been seen so far, which is
//   NOT purely a function of (state, symbol) - so it's folded into the
//   transition as a third dimension (a small ancestor-key bitset, one bit
//   per distinct filter key in the whole pattern), i.e. a genuine product
//   automaton. Selectors with no filters at all (the `..`/wildcard-heavy
//   shapes this issue is actually about, e.g. `$..plugins`) never pay for
//   this dimension - the bits value is always 0 and drops out of the memo
//   key.

import { Step } from './selector';

export type Symbol = { type: 'ARRAY' } | { type: 'KEY'; name: string };

const ARRAY_SYMBOL: Symbol = { type: 'ARRAY' };

// Thread tags: `W<i>` (waiting to consume step i; i === steps.length means
// "pattern fully matched"), `AR<i>` (ONE ARRAY level already skipped
// transparently - fresh, hasn't skipped a second one yet - still waiting to
// consume step i beneath it), `AR2<i>` (already skipped a SECOND+ array
// level too - a Wildcard step's own KEY-consumption is no longer available
// from here, only further array-skipping if tolerant - see expandArrayRetry;
// a Child step never reaches this, since it never tolerates a second array
// at all), `DS<i>` (inside step i's leading '..' - Kleene-star skip, still
// also trying to consume step i on every event in parallel).
type ThreadTag = string;

function W(i: number): ThreadTag { return `W${i}`; }
function AR(i: number): ThreadTag { return `A${i}`; }
function AR2(i: number): ThreadTag { return `B${i}`; }
function DS(i: number): ThreadTag { return `D${i}`; }

// "Finished, currently inside the last-consumed step's own array-
// transparency window." Unlike W/AR/DS these carry no step index: they only
// ever exist after the WHOLE pattern has been consumed, so there is nothing
// left to index into. Two flavors, distinguished by whether the completing
// step's array-transparency "hop" has already been spent:
//   FRESH_TAG: the pattern was just completed by a KEY event (an ordinary
//     Child/Wildcard key match) - the completed step hasn't faced any array
//     yet, so it still gets its OWN one free single-hop pass before
//     finalTolerates starts gating further arrays (mirrors AR(i)'s own
//     single-free-hop rule, applied to the now-fully-consumed step).
//   SPENT_TAG: the pattern was just completed by a Wildcard directly
//     consuming an ARRAY event itself (expandWaiting's branch (a)) - THAT
//     array event IS the completed step's one hop, already used, so a
//     FURTHER array is immediately gated by finalTolerates with no
//     additional free pass (fixes a bug found by differential testing:
//     without this distinction, `$.*` over a top-level array-of-arrays
//     wrongly matched two array levels deep instead of stopping at the
//     inner array as one whole captured value).
const FRESH_TAG: ThreadTag = 'F';
const SPENT_TAG: ThreadTag = 'H';

export class CompiledAutomaton {

    readonly steps: Step[];
    readonly filterKeyIndex: Map<string, number> = new Map();
    private readonly tolerateArrayChain: boolean[];
    private readonly finalTolerates: boolean;

    // DFA state table: id -> canonical (sorted) thread-tag set. State 0 is
    // always the initial state (closure({W0})).
    private readonly stateThreads: ThreadTag[][] = [];
    private readonly stateKeyToId: Map<string, number> = new Map();
    readonly initialStateId: number;

    // Lazy transition memo: `${stateId}|${symbolKey}|${bits}` -> next state id.
    private readonly transitionCache: Map<string, number> = new Map();

    // Perf counters (used by the benchmark to report amortized/cold cost).
    coldTransitions = 0;
    warmTransitions = 0;

    constructor(steps: Step[]) {
        this.steps = steps;
        for (const s of steps) {
            if (s.filterKey !== undefined && !this.filterKeyIndex.has(s.filterKey)) {
                this.filterKeyIndex.set(s.filterKey, this.filterKeyIndex.size);
            }
        }
        // Mirrors YAJSPath.match()'s tolerateConsecutiveArrays: a Wildcard
        // tolerates unbounded further array levels iff the pattern operator
        // immediately preceding it is itself a Wildcard or a Descendant -
        // i.e. this step is either itself preceded by '..' (descendant:
        // true), or its immediately preceding step (no '..' of its own
        // between them) is a Wildcard.
        this.tolerateArrayChain = steps.map((s, i) =>
            s.kind === 'WILDCARD' && (s.descendant || (i >= 1 && steps[i - 1].kind === 'WILDCARD')));
        // Whether a FULLY MATCHED pattern (thread W(steps.length)) tolerates
        // more than one further transparent ARRAY level once matched - the
        // exact same rule as any other step's own array-retry tolerance,
        // applied to the last step. Necessary because match() is never
        // actually tested "as of" the array's own bare container position
        // in the real engine (see FT below) - a value one array-transparency
        // hop past a just-matched key/wildcard is STILL that same match
        // (e.g. `$.a` over `{"a":[1,2,3]}` matches each of 1, 2, 3 - the
        // array is transparent for the JUST-CONSUMED "a" too, not only for
        // an operator still pending) - single-hop unless the last step is a
        // Wildcard whose own predecessor is itself Wildcard/Descendant
        // (issue #38's unbounded-intervening-array-depth case).
        this.finalTolerates = steps.length > 0 && this.tolerateArrayChain[steps.length - 1];
        this.initialStateId = this.internState(this.closure(new Set([W(0)])));
    }

    get hasFilters(): boolean {
        return this.filterKeyIndex.size > 0;
    }

    isAccepting(stateId: number): boolean {
        const threads = this.stateThreads[stateId];
        // W(steps.length) itself is never actually interned (see
        // expandWaiting/expandArrayRetry: completion always substitutes
        // FRESH_TAG or SPENT_TAG instead) - kept in the check anyway as a
        // defensive fallback in case steps.length === 0 ever reaches here.
        return threads.includes(W(this.steps.length)) || threads.includes(FRESH_TAG) || threads.includes(SPENT_TAG);
    }

    transition(stateId: number, symbol: Symbol, bits: number): number {
        const symbolKey = symbol.type === 'ARRAY' ? 'A' : `K:${symbol.name}`;
        const cacheKey = this.hasFilters ? `${stateId}|${symbolKey}|${bits}` : `${stateId}|${symbolKey}`;
        const cached = this.transitionCache.get(cacheKey);
        if (cached !== undefined) {
            this.warmTransitions++;
            return cached;
        }
        this.coldTransitions++;
        const threads = this.stateThreads[stateId];
        const rawNext = new Set<ThreadTag>();
        for (const tag of threads) {
            for (const nt of this.expandThread(tag, symbol, bits)) {
                rawNext.add(nt);
            }
        }
        const nextId = this.internState(this.closure(rawNext));
        this.transitionCache.set(cacheKey, nextId);
        return nextId;
    }

    private expandThread(tag: ThreadTag, symbol: Symbol, bits: number): ThreadTag[] {
        if (tag === FRESH_TAG) {
            // Already fully matched via a KEY completion, hasn't faced an
            // array yet: a KEY event ends it (going into a matched value's
            // own properties is not itself still a match of the OUTER
            // pattern); the FIRST trailing ARRAY is always tolerated (its
            // own one free hop, exactly like AR(i)'s), spending it and
            // moving to SPENT_TAG.
            return symbol.type === 'ARRAY' ? [SPENT_TAG] : [];
        }
        if (tag === SPENT_TAG) {
            // Already fully matched AND already used its one free
            // array-transparency hop (either it was FRESH_TAG that just
            // spent it above, or it was completed directly by a Wildcard
            // consuming an ARRAY event itself - see expandWaiting's branch
            // (a) - which IS that one hop, already spent by construction).
            // A further ARRAY level continues only if the last-consumed
            // step tolerates an unbounded array chain.
            return symbol.type === 'ARRAY' && this.finalTolerates ? [SPENT_TAG] : [];
        }
        const kind = tag.charAt(0);
        const i = Number(tag.slice(1));
        if (kind === 'D') {
            // Kleene-star: keep skipping AND try consuming step i now, in parallel.
            return [DS(i), ...this.expandWaiting(i, symbol, bits)];
        }
        if (kind === 'A') {
            return this.expandArrayRetry(i, symbol, bits, false);
        }
        if (kind === 'B') {
            return this.expandArrayRetry(i, symbol, bits, true);
        }
        // 'W', not yet fully matched (fully-matched W threads are never
        // interned as plain W(steps.length) - expandWaiting substitutes
        // FRESH_TAG/SPENT_TAG the moment a transition would complete the
        // pattern - see below).
        return this.expandWaiting(i, symbol, bits);
    }

    private expandWaiting(i: number, symbol: Symbol, bits: number): ThreadTag[] {
        const step = this.steps[i];
        const out: ThreadTag[] = [];
        const filterOk = this.filterOk(step.filterKey, bits);
        const completes = i + 1 >= this.steps.length;
        if (step.kind === 'CHILD') {
            if (symbol.type === 'KEY' && symbol.name === step.key && filterOk) {
                // A Child only ever completes via a KEY (it has no "branch
                // (a) consume the array directly" reading) - always fresh.
                out.push(completes ? FRESH_TAG : W(i + 1));
            } else if (symbol.type === 'ARRAY') {
                out.push(AR(i)); // single-hop array transparency, retry same step
            }
        } else { // WILDCARD
            if (symbol.type === 'KEY') {
                if (filterOk) {
                    out.push(completes ? FRESH_TAG : W(i + 1));
                }
            } else {
                // Both readings tried in parallel - no backtracking.
                if (filterOk) {
                    // (a) array level itself is the hop - THIS array IS the
                    // completed step's one hop, already spent.
                    out.push(completes ? SPENT_TAG : W(i + 1));
                }
                out.push(AR(i)); // (b) array transparent, hop is beneath it
            }
        }
        return out;
    }

    // `spent` distinguishes AR(i) (false - just arrived via exactly ONE
    // array, its own single free hop still unused) from AR2(i) (true -
    // already skipped a SECOND+ array too). Differential testing found both
    // a Child's and a tolerant-chain Wildcard's "array, then a key beneath
    // it" reading is only valid on that FIRST, still-fresh hop - e.g.
    // `$.*.*` over `{"m":[[{"a":1}]]}` must NOT reach "a" (two arrays
    // beneath the second wildcard - the object `{"a":1}` is already fully
    // captured, as a whole, by the tolerant chain's own array self-looping;
    // reaching "a" too would be a second, spurious match one level too deep
    // into that same value) while `$.*.*` over `{"plugins":[{"name":"p1"}]}`
    // MUST reach "name" (only one array beneath the second wildcard, exactly
    // the tolerated chain's own documented "resolve one hop at a time down
    // to the array" case, mirroring how a plain `$.arr.*` reaches inside an
    // array-of-objects's elements at all).
    private expandArrayRetry(i: number, symbol: Symbol, bits: number, spent: boolean): ThreadTag[] {
        const step = this.steps[i];
        const completes = i + 1 >= this.steps.length;
        if (symbol.type === 'KEY') {
            if (spent) {
                // Already past its one free hop - see the method comment.
                return [];
            }
            const filterOk = this.filterOk(step.filterKey, bits);
            if (step.kind === 'CHILD' && symbol.name === step.key && filterOk) {
                // Completed via a KEY, one array-transparency hop away from
                // here (the one AR(i) itself already represents) - that
                // hop belongs to WHATEVER reached AR(i) in the first place,
                // not to this now-fully-consumed step; this step gets its
                // OWN fresh budget for anything trailing IT.
                return [completes ? FRESH_TAG : W(i + 1)];
            }
            // A Wildcard's own (still-fresh) KEY-consumption here is only
            // valid when this wildcard is part of a tolerant chain (its own
            // predecessor is Wildcard/Descendant - the same tolerateArrayChain
            // gate as the ARRAY case below). For a NON-chained wildcard
            // (predecessor Root/Child), the array's element is ALREADY
            // independently matched one level shallower, at the array's own
            // container depth, via the "consume the array directly" reading
            // (expandWaiting's WILDCARD/ARRAY branch (a)) - letting THIS
            // retry ALSO consume the element's own key would be a second,
            // spurious match of the very same element (real's own
            // "overshoot" rejection in YAJSPath.match() exists precisely to
            // prevent this duplicate/racing match).
            if (step.kind === 'WILDCARD' && filterOk && this.tolerateArrayChain[i]) {
                return [completes ? FRESH_TAG : W(i + 1)];
            }
            return [];
        }
        // symbol.type === 'ARRAY': a further consecutive array. Only
        // tolerated when this wildcard's own predecessor in the pattern is
        // itself a Wildcard/Descendant (issue #38's unbounded-intervening-
        // depth case) - and, once tolerated, moves to the "spent" flavor:
        // this step's own budget for reaching a key DIRECTLY is used up
        // either way (that only ever applied to the first, now-past array),
        // but further pure array-skipping continues for as long as the
        // chain stays tolerant.
        if (this.tolerateArrayChain[i]) {
            return [AR2(i)];
        }
        return [];
    }

    private filterOk(filterKey: string | undefined, bits: number): boolean {
        if (filterKey === undefined) {
            return true;
        }
        const idx = this.filterKeyIndex.get(filterKey);
        return idx !== undefined && (bits & (1 << idx)) !== 0;
    }

    // Replaces any raw W(i) thread whose step[i] is itself preceded by '..'
    // with DS(i) - a bare W(i) is never a valid resting state for such a
    // step; it must always be reached through the descendant skip.
    private closure(raw: Set<ThreadTag>): Set<ThreadTag> {
        const out = new Set<ThreadTag>();
        for (const tag of raw) {
            if (tag.charAt(0) === 'W') {
                const i = Number(tag.slice(1));
                if (i < this.steps.length && this.steps[i].descendant) {
                    out.add(DS(i));
                    continue;
                }
            }
            out.add(tag);
        }
        return out;
    }

    private internState(threads: Set<ThreadTag>): number {
        const sorted = [...threads].sort();
        const key = sorted.join(',');
        const existing = this.stateKeyToId.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const id = this.stateThreads.length;
        this.stateThreads.push(sorted);
        this.stateKeyToId.set(key, id);
        return id;
    }
}

export function compile(steps: Step[]): CompiledAutomaton {
    return new CompiledAutomaton(steps);
}

// Runtime matcher: a stack of DFA states (+ ancestor filter-key bits)
// mirroring StreamPosition's own position stack, so matching a new event is
// one transition() lookup plus a push, and leaving a level is a pop - no
// pattern re-walk.
export class AutomatonMatcher {

    private readonly automaton: CompiledAutomaton;
    private stateStack: number[];
    private bitsStack: number[];

    constructor(automaton: CompiledAutomaton) {
        this.automaton = automaton;
        this.stateStack = [automaton.initialStateId];
        this.bitsStack = [0];
    }

    get matched(): boolean {
        return this.automaton.isAccepting(this.stateStack[this.stateStack.length - 1]);
    }

    // Push a new object slot (key not yet known - mirrors stepIntoObject()).
    enterObjectSlot(): void {
        const top = this.stateStack.length - 1;
        this.stateStack.push(this.stateStack[top]);
        this.bitsStack.push(this.bitsStack[top]);
    }

    // Sets/replaces the current object slot's key (mirrors updateObjectEntry() -
    // callable more than once per slot for a multi-key object). Returns
    // whether the resulting position matches.
    setKey(name: string): boolean {
        const parentIdx = this.stateStack.length - 2;
        const parentState = this.stateStack[parentIdx];
        const parentBits = this.bitsStack[parentIdx];
        const nextState = this.automaton.transition(parentState, { type: 'KEY', name }, parentBits);
        const filterIdx = this.automaton.filterKeyIndex.get(name);
        const nextBits = filterIdx === undefined ? parentBits : (parentBits | (1 << filterIdx));
        const top = this.stateStack.length - 1;
        this.stateStack[top] = nextState;
        this.bitsStack[top] = nextBits;
        return this.automaton.isAccepting(nextState);
    }

    exitObjectSlot(): void {
        this.stateStack.pop();
        this.bitsStack.pop();
    }

    // Pushes an array slot (mirrors stepIntoArray()) and returns whether the
    // resulting position matches - valid for every element of the array,
    // since no operator in this grammar subset is index-sensitive.
    enterArraySlot(): boolean {
        const top = this.stateStack.length - 1;
        const parentState = this.stateStack[top];
        const parentBits = this.bitsStack[top];
        const nextState = this.automaton.transition(parentState, ARRAY_SYMBOL, parentBits);
        this.stateStack.push(nextState);
        this.bitsStack.push(parentBits);
        return this.automaton.isAccepting(nextState);
    }

    exitArraySlot(): void {
        this.stateStack.pop();
        this.bitsStack.pop();
    }
}
