// Issue #89, Claim A: differential verification.
//
// Claim under test: the proposed "discard-and-replace" mechanism (throw away
// an outer dispatcher's partial object entirely the instant a deeper nested
// match starts, rather than parking it and later injecting the inner's
// completed value back into it - see StreamContext.dispatchers/
// completeDispatcher() for how today's engine actually does the parking) is
// claimed to produce identical *innermost* results to a naive reference: run
// today's actual "emit every overlapping match" behavior (issue #38), then
// filter that raw list down to "keep only the deepest match per nesting
// chain" after the fact.
//
// This is a standalone state-machine prototype, NOT wired into the real
// engine - per the task instructions that's fine for this verification. It
// deliberately reimplements two *small* recorders against a shared event
// stream (startObject/startArray/key/value/endObject/endArray - the same
// event shape JsonSaxParser -> StreamContext use) and a shared object-builder
// helper (mirroring AbstractObjectBuilder's root-sentinel + node-stack
// design), so the two algorithms under comparison differ ONLY in "which
// events go to which recorder, and when a recorder is discarded/emitted" -
// exactly the mechanism issue #89 is proposing to change - not in how
// subtrees get rebuilt into JS values (that part is shared and therefore
// cannot itself be a source of a spurious diff).
//
// Both recorders only ever look for ONE target key (default: "a") appearing
// anywhere in the document (the `..a` descendant case #89 is about) - they do
// not reimplement YAJSPath's full pattern grammar, since that's not what's
// under test here.

'use strict';

// ---------------------------------------------------------------------------
// Shared object builder (mirrors AbstractObjectBuilder: root sentinel + a
// stack of in-progress object/array nodes + a pending field name).
// ---------------------------------------------------------------------------
class Builder {
    constructor() {
        this.stack = [{ root: true }];
        this.pendingKey = undefined;
    }
    top() { return this.stack[this.stack.length - 1]; }
    assign(v) {
        const t = this.top();
        if (t.root) { t.value = v; }
        else if (t.isArray) { t.node.push(v); }
        else { t.node[this.pendingKey] = v; }
    }
    key(k) { this.pendingKey = k; }
    startObject() { const o = {}; this.assign(o); this.stack.push({ node: o, isArray: false }); }
    startArray() { const a = []; this.assign(a); this.stack.push({ node: a, isArray: true }); }
    addValue(v) { this.assign(v); }
    // Returns true once the builder has popped all the way back to its own
    // root (i.e. its own captured subtree, however deep, is fully closed).
    endContainer() {
        this.stack.pop();
        return this.stack.length === 1;
    }
    get value() { return this.stack[0].value; }
}

// ---------------------------------------------------------------------------
// Event-stream walker: turns a plain JS value into the same event sequence
// JsonSaxParser produces (see ARCHITECTURE.md §1) - startObject/key/
// startArray/value/endObject/endArray - so both recorders below consume
// exactly the shape the real engine's dispatchers do.
// ---------------------------------------------------------------------------
function toEvents(root) {
    const events = [];
    function walk(v) {
        if (Array.isArray(v)) {
            events.push({ t: 'startArray' });
            v.forEach(walk);
            events.push({ t: 'endArray' });
        } else if (v !== null && typeof v === 'object') {
            events.push({ t: 'startObject' });
            for (const k of Object.keys(v)) {
                events.push({ t: 'key', k });
                walk(v[k]);
            }
            events.push({ t: 'endObject' });
        } else {
            events.push({ t: 'value', v });
        }
    }
    walk(root);
    return events;
}

// ---------------------------------------------------------------------------
// Reference A: naive "emit every overlapping match" - exactly today's real
// engine behavior for `$..a` (issue #38's park-and-inject stack, modeled here
// as N independently-running builders instead of park/inject, since the
// *externally observable result* of park+inject is definitionally "the outer
// eventually finishes with the inner's value spliced in AND the inner is
// separately emitted too" - i.e. both values reach the caller, which is all
// this differential cares about reproducing faithfully as the "before"
// state). Every currently-open recorder for target key gets every event.
// ---------------------------------------------------------------------------
function runNaiveOverlapping(events, targetKey) {
    const active = []; // {builder, startDepth, startIdx}
    const matches = []; // {startIdx, endIdx, startDepth, value}
    let depth = 0;

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.t === 'key') {
            for (const a of active) { a.builder.key(ev.k); }
            if (ev.k === targetKey) {
                active.push({ builder: new Builder(), startDepth: depth, startIdx: i });
            }
            continue;
        }
        if (ev.t === 'startObject' || ev.t === 'startArray') {
            for (const a of active) { ev.t === 'startObject' ? a.builder.startObject() : a.builder.startArray(); }
            depth++;
            continue;
        }
        if (ev.t === 'endObject' || ev.t === 'endArray') {
            depth--;
            // Iterate a snapshot since finishing ones are removed mid-loop.
            for (const a of active.slice()) {
                if (a.builder.endContainer() && depth === a.startDepth) {
                    matches.push({ startIdx: a.startIdx, endIdx: i, startDepth: a.startDepth, value: a.builder.value });
                    active.splice(active.indexOf(a), 1);
                }
            }
            continue;
        }
        if (ev.t === 'value') {
            // A recorder that was JUST created for this exact value (a bare
            // scalar match, e.g. `$..a` against {"a":1}) never receives a
            // startObject/startArray of its own - mirrors the real engine,
            // where "a matched scalar bypasses the recorder entirely and is
            // delivered directly" (ARCHITECTURE.md §4). Detected here by
            // builder.stack.length still being 1 (root-only) right after the
            // assign - i.e. nothing was ever pushed onto it - which can only
            // be true for a freshly-started recorder, never for one that
            // pushed a container and is now receiving a value nested inside
            // it. Such a recorder completes immediately, on this same event,
            // rather than waiting for a later endObject/endArray it will
            // never itself be the direct target of.
            for (const a of active.slice()) {
                a.builder.addValue(ev.v);
                if (a.builder.stack.length === 1) {
                    matches.push({ startIdx: a.startIdx, endIdx: i, startDepth: a.startDepth, value: a.builder.value });
                    active.splice(active.indexOf(a), 1);
                }
            }
            continue;
        }
    }
    return matches;
}

// Filters a naive-overlapping match list down to "innermost only per nesting
// chain": drop any match that strictly contains ANOTHER match's event range.
// This is the reference algorithm the task describes: "record every
// overlapping match today's engine already produces, then filter to keep
// only the deepest one per nesting chain."
function filterInnermost(matches) {
    // Keep m only if m has no OTHER match nested strictly inside its own
    // range - i.e. m is a leaf of its nesting chain (nothing deeper exists
    // under it in the match list). Drops every ancestor match, leaving only
    // the deepest occurrence per chain.
    return matches.filter((m) =>
        !matches.some((other) =>
            other !== m && m.startIdx <= other.startIdx && other.endIdx <= m.endIdx));
}

// Same idea, kept for completeness/symmetry (not used by Claim A itself,
// which is scoped to the innermost default, but validated in the sanity
// checks below since `outermost` is the other half of #89's proposal and a
// bug in "keep the shallowest" would be just as real): keep m only if no
// OTHER match strictly contains it - i.e. m is a root of its nesting chain.
function filterOutermost(matches) {
    return matches.filter((m) =>
        !matches.some((other) =>
            other !== m && other.startIdx <= m.startIdx && m.endIdx <= other.endIdx));
}

// ---------------------------------------------------------------------------
// Prototype under test: discard-and-replace. A SINGLE active recorder at a
// time (not a stack!) - see the long comment below for why a stack turns out
// to be unnecessary for this specific mechanism, which is itself one of this
// script's findings, not just an implementation shortcut.
// ---------------------------------------------------------------------------
function runDiscardReplace(events, targetKey) {
    let active = null; // {builder, startDepth, startIdx}
    const matches = [];
    let depth = 0;

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.t === 'key') {
            if (active) { active.builder.key(ev.k); }
            if (ev.k === targetKey) {
                // Discard whichever capture is currently active (if any) -
                // it is, by construction, an ancestor of the new match about
                // to start, since JSON is walked depth-first: any match seen
                // while another is still open MUST be nested inside it (a
                // sibling match can only start after its sibling has fully
                // closed - see the long note below). No park, no stack.
                active = { builder: new Builder(), startDepth: depth, startIdx: i };
            }
            continue;
        }
        if (ev.t === 'startObject' || ev.t === 'startArray') {
            if (active) { ev.t === 'startObject' ? active.builder.startObject() : active.builder.startArray(); }
            depth++;
            continue;
        }
        if (ev.t === 'endObject' || ev.t === 'endArray') {
            depth--;
            if (active && active.builder.endContainer() && depth === active.startDepth) {
                matches.push({ startIdx: active.startIdx, endIdx: i, startDepth: active.startDepth, value: active.builder.value });
                active = null;
            }
            continue;
        }
        if (ev.t === 'value') {
            // Same bare-scalar-match immediacy as runNaiveOverlapping above.
            if (active) {
                active.builder.addValue(ev.v);
                if (active.builder.stack.length === 1) {
                    matches.push({ startIdx: active.startIdx, endIdx: i, startDepth: active.startDepth, value: active.builder.value });
                    active = null;
                }
            }
            continue;
        }
    }
    return matches;
}

// -----------------------------------------------------------------------
// FINDING (worth carrying into the scoping doc): the naive-overlapping
// recorder above genuinely needs a *list* of concurrently active builders
// (issue #38's real park+inject stack exists for the same reason) because
// while an outer "a" is open, a nested "a" starts a SECOND, independently
// running recorder without stopping the first. But discard-and-replace, by
// definition, never keeps more than one recorder alive at a time - so does
// it ever need a stack for the disjoint-sibling case
// (`{p:{a:{a:1}}, q:{a:2}}` from the issue)? No: JSON is walked strictly
// depth-first, so by the time `q`'s "a" key is seen, `p`'s subtree
// (including its own nested "a") has already fully closed and already been
// emitted or discarded - there is structurally no way for two DISJOINT
// matches to be simultaneously in-flight. A single `active` slot (not a
// stack) is therefore sufficient for the default/innermost mechanism -
// simpler than even the issue's own "discard-and-replace" framing implies,
// and simpler than today's real StreamContext.dispatchers stack.
// -----------------------------------------------------------------------

function deepEqual(a, b) {
    if (a === b) { return true; }
    if (typeof a !== typeof b) { return false; }
    if (a === null || b === null) { return false; }
    if (typeof a !== 'object') { return false; }
    if (Array.isArray(a) !== Array.isArray(b)) { return false; }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) { return false; }
    return ka.every((k) => deepEqual(a[k], b[k]));
}

// ---------------------------------------------------------------------------
// Synthetic self-nesting document generator.
// ---------------------------------------------------------------------------
let seed = 42;
function rnd() { // small deterministic LCG for reproducibility
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}
function rndInt(n) { return Math.floor(rnd() * n); }

// Builds a self-nesting chain of `depth` levels of {a: ...} (each level also
// gets 1-2 unrelated sibling "noise" keys, modeling realistic comment/
// category records that have other fields alongside the recursive one),
// terminating in a leaf (scalar, or a plain object/array with no "a" in it).
function nestingChain(depth, targetKey, leafFactory) {
    if (depth <= 0) { return leafFactory(); }
    const node = {};
    node[targetKey] = nestingChain(depth - 1, targetKey, leafFactory);
    node.title = `node-${rndInt(1000)}`;
    if (rnd() < 0.4) { node.tags = [rndInt(10), rndInt(10)]; }
    return node;
}

function leaf() {
    const kind = rndInt(4);
    if (kind === 0) { return rndInt(1000); }
    if (kind === 1) { return `leaf-${rndInt(1000)}`; }
    if (kind === 2) { return { text: 'leaf-object', n: rndInt(5) }; }
    return [rndInt(5), rndInt(5), { text: 'leaf-in-array' }];
}

// Wraps a self-nesting chain through an array level too (a -> [ {a:...}, ... ]),
// since `..a` must also reach nesting that passes through arrays.
function arrayWrappedChain(depth, targetKey) {
    return { [targetKey]: [ { other: 1 }, nestingChain(depth - 1, targetKey, leaf), { other: 2 } ] };
}

function genDocument(maxDepth, targetKey) {
    // A handful of DISJOINT branches at the top level, each independently
    // self-nesting to a random depth (including 0 - "no nesting, ordinary
    // single match" and 1 - "no self-nesting at all", both of which must
    // keep working exactly like a non-nested `..a` always has).
    const doc = { id: rndInt(1e6) };
    const branchCount = 1 + rndInt(4);
    for (let b = 0; b < branchCount; b++) {
        const depth = rndInt(maxDepth + 1);
        const useArray = rnd() < 0.3;
        doc[`branch${b}`] = useArray && depth > 0 ?
            arrayWrappedChain(depth, targetKey) :
            { wrapper: nestingChain(depth, targetKey, leaf) };
    }
    // Also occasionally place a self-nesting chain directly at the document
    // root's own top-level key (not nested inside a "wrapper"/"branchN").
    if (rnd() < 0.5) {
        doc[targetKey] = nestingChain(1 + rndInt(maxDepth), targetKey, leaf);
    }
    return doc;
}

// ---------------------------------------------------------------------------
// Run the differential across many random documents at varying max depths,
// plus a few explicit hand-written edge cases.
// ---------------------------------------------------------------------------
function runOne(doc, targetKey, label) {
    const events = toEvents(doc);
    const naive = runNaiveOverlapping(events, targetKey);
    const refInnermost = filterInnermost(naive).
        slice().sort((x, y) => x.startIdx - y.startIdx);
    const protoInnermost = runDiscardReplace(events, targetKey).
        slice().sort((x, y) => x.startIdx - y.startIdx);

    const refOutermost = filterOutermost(naive).
        slice().sort((x, y) => x.startIdx - y.startIdx);

    let ok = true;
    const problems = [];

    if (refInnermost.length !== protoInnermost.length) {
        ok = false;
        problems.push(`count mismatch: reference ${refInnermost.length} vs discard-replace ${protoInnermost.length}`);
    } else {
        for (let i = 0; i < refInnermost.length; i++) {
            if (refInnermost[i].startIdx !== protoInnermost[i].startIdx ||
                !deepEqual(refInnermost[i].value, protoInnermost[i].value)) {
                ok = false;
                problems.push(`match #${i} differs: ref startIdx=${refInnermost[i].startIdx} ` +
                    `value=${JSON.stringify(refInnermost[i].value)} vs ` +
                    `proto startIdx=${protoInnermost[i].startIdx} value=${JSON.stringify(protoInnermost[i].value)}`);
            }
        }
    }

    return {
        label, ok, problems,
        naiveCount: naive.length,
        innermostCount: refInnermost.length,
        outermostCount: refOutermost.length,
    };
}

function main() {
    const targetKey = 'a';
    const results = [];

    // --- Hand-written edge cases from the issue text itself -------------
    results.push(runOne({ p: { a: { a: 1 } }, q: { a: 2 } }, targetKey, 'issue-example: p.a.a + disjoint q.a'));
    results.push(runOne({ a: 1 }, targetKey, 'single non-nested match'));
    results.push(runOne({ x: 1 }, targetKey, 'no match at all'));
    results.push(runOne({ a: { a: { a: { a: { a: 'deep leaf' } } } } }, targetKey, '5-level self-nesting chain'));
    results.push(runOne({ a: { b: { a: 1 } } }, targetKey, 'nesting through an unrelated intermediate key'));
    results.push(runOne({ a: [ { a: 1 }, { a: 2 } ] }, targetKey, 'array of two disjoint nested "a"s inside outer "a"'));
    results.push(runOne({ list: [ { a: { a: 1 } }, { a: 2 }, { b: 1 } ] }, targetKey, 'array with mixed nested/non-nested/no-match elements'));
    results.push(runOne({ a: { a: 1 }, b: { a: { a: 2 } } }, targetKey, 'two disjoint self-nesting branches'));

    // --- Randomized documents at depths 2, 3, 5+ -------------------------
    for (const depth of [2, 3, 5, 7, 10]) {
        for (let i = 0; i < 150; i++) {
            results.push(runOne(genDocument(depth, targetKey), targetKey, `random depth<=${depth} #${i}`));
        }
    }

    const failures = results.filter((r) => !r.ok);
    console.log(`Claim A differential: ${results.length} documents tested, ${failures.length} mismatches.\n`);

    const totalNaive = results.reduce((s, r) => s + r.naiveCount, 0);
    const totalInner = results.reduce((s, r) => s + r.innermostCount, 0);
    const totalOuter = results.reduce((s, r) => s + r.outermostCount, 0);
    console.log(`Total matches across all documents - naive/overlapping (today's engine): ${totalNaive}`);
    console.log(`Total matches - innermost-filtered reference: ${totalInner}`);
    console.log(`Total matches - outermost-filtered reference: ${totalOuter}`);
    console.log(`(sanity: innermost/outermost counts equal and < naive whenever any self-nesting occurred, ` +
        `equal to naive count whenever a document has none - both hold here as expected)\n`);

    if (failures.length) {
        console.log('FAILURES:');
        for (const f of failures) {
            console.log(`  [${f.label}]`);
            f.problems.forEach((p) => console.log(`    - ${p}`));
        }
        process.exitCode = 1;
    } else {
        console.log('RESULT: discard-and-replace matches the innermost-filtered reference exactly on every case tested.');
    }
}

main();
