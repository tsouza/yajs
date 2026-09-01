// The SKIP/PARSE/DESCEND span-parsing hybrid (issues #79/#87): a selector
// plan compiler plus a structural byte-level matcher that navigates a
// document's bytes directly (DESCEND), skips subtrees a fast native
// pre-filter proves can't contain a match (SKIP), and hands only the
// bytes of an actual match to `JSON.parse` (PARSE) - never the whole
// record. See HybridFastPath.ts for the resumable, chunk-crossing
// top-level driver that feeds this; this module is entirely synchronous
// and assumes every byte range it's asked to scan is already fully
// available (true by construction - see collectMatches()'s doc comment).
//
// Design notes (see #87's own scope discussion for the questions these
// answer):
//
//  - Scope: exactly one selector shape is compiled - `$..k1.k2...kn`
//    (Root, one Descendant, one or more plain non-filtered ChildNode
//    keys; no definite prefix before the '..', no wildcards, no
//    ancestor-key filters, no second Descendant). This is deliberately
//    narrower than GenericWalker's "any selector shape": it's exactly the
//    shape all three of this repo's own flagship descendant selectors
//    have (`$..plugins`, `$..array.deep1`), and the shape the #79 spike
//    was measured against. A selector outside this shape (including a
//    PLAIN DEFINITE CHAIN with no descendant at all, e.g.
//    `$.field2.nested`) makes compileHybridPlan() return null - see
//    HybridFastPath.ts for what happens then. Plain definite chains are
//    deliberately not reimplemented here: the existing shipped
//    ChainEvaluator (FastPathEvaluator.ts) already gets the SKIP-model's
//    real benefit for that shape (avoiding the streaming tokenizer/
//    pattern-matcher entirely via one JSON.parse + O(chain length)
//    navigation) - a byte-level DESCEND for a plain chain wouldn't skip
//    any additional work ChainEvaluator doesn't already skip, just
//    reimplement it, so HybridFastPath delegates that shape to the
//    existing machinery wholesale instead (reuse over reinvention, per
//    #87's own scope note).
//  - Why the target/suffix keys are charset-restricted: see
//    keyNeedle()'s own doc comment in SpanBuffer.ts - the native indexOf
//    pre-filter needs the key's JSON-string encoding to be unambiguous.
//  - Why `pathIncludeArrayIndex` isn't supported: correct array-index
//    path segments require knowing which array a match is under, which
//    (unlike key names) this design's pre-filter-then-DESCEND approach
//    doesn't track for subtrees it skips past without recursing into.
//    Selectors requesting it fall back the same way a wildcard/filter
//    selector does.
//  - Issue #89/#14 interaction (self-nesting/innermost-only default,
//    combined with array fan-out): see this file's own "collect, then
//    filter, then emit" three-phase design below - collectMatches()'s doc
//    comment explains why innermost-only can't be decided locally, one
//    candidate at a time, the way an earlier version of this file tried
//    (a real, differential-test-caught bug - see git history/PR
//    discussion for `$..c.a` against `{"c":{"c":{"a":0},"a":[0]}}` and
//    `$..c` against `{"c":[{"c":false},{}]}`, both now permanent
//    regression cases in src/test/13-hybrid-fastpath.ts).
'use strict';

import { ChildNode } from '../path/operator/ChildNode';
import { PathOperator } from '../path/PathOperator';
import { YAJSPath } from '../path/YAJSPath';
import { EmitFn, FastPathOptions } from './FastPathEvaluator';
import { keyNeedle, scanValueEnd, SpanBuffer } from './SpanBuffer';

const QUOTE = 0x22;
const COLON = 0x3a;
const COMMA = 0x2c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

function isWs(b: number): boolean {
    return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
}

function isContainerByte(b: number): boolean {
    return b === OPEN_BRACE || b === OPEN_BRACKET;
}

function skipWs(buf: SpanBuffer, from: number, end: number): number {
    let i = from;
    while (i < end && isWs(buf.byteAt(i))) { i++; }
    return i;
}

/** Only plain ASCII "identifier-ish" keys are supported - see
 * keyNeedle()'s own doc comment for why: it guarantees
 * `JSON.stringify(key)` is the ONLY valid JSON encoding of that string
 * (no character in it ever *requires or permits* an alternate `\uXXXX`
 * escape from a real encoder to mean the same thing), which is what makes
 * the native indexOf pre-filter safe to use as a skip decision. */
const SAFE_KEY = /^[A-Za-z0-9_$.\-]+$/;

/** Thrown by the synchronous matcher for anything it can't safely handle
 * inline - malformed bytes, or a matched span over the configured size
 * cutoff. Caught by HybridFastPath.ts, which routes the record to the
 * real streaming engine instead (same "correctness over speed when
 * ambiguous" fallback philosophy as the shipped fastPathMaxRecordBytes
 * cutoff - see NdjsonFastPath.ts). Thrown only from the COLLECT phase
 * (before anything is emitted for the current top-level entry - see
 * HybridFastPath.ts's own per-entry collect/filter/emit sequencing), so a
 * bailout never leaves a partial/wrong match already delivered to the
 * caller. */
export class HybridBailoutError extends Error {}

/** One raw candidate match, gathered by collectMatches()/collectSuffixHits()
 * before any issue #89 innermost-only filtering has been applied - see
 * this file's own top comment for why filtering is a separate, later
 * phase rather than a decision made locally while collecting. */
export interface RawMatch {
    path: Array<string | number>;
    start: number;
    end: number;
}

export interface HybridPlan {
    readonly targetKey: string;
    readonly targetNeedle: Buffer;
    readonly suffixKeys: string[];
    readonly maxSpanBytes: number;
}

const DEFAULT_MAX_SPAN_BYTES = 8 * 1024 * 1024;

/**
 * Compiles a YAJSPath into a HybridPlan, or returns null if its shape
 * isn't one this evaluator supports (see this file's own top comment for
 * exactly which shapes qualify) - the caller (HybridFastPath.ts) falls
 * back to the existing shipped fast-path machinery for null.
 */
export function compileHybridPlan(yajsPath: YAJSPath, options: FastPathOptions & { hybridMaxSpanBytes?: number }): HybridPlan | null {
    if (options.pathIncludeArrayIndex) { return null; }
    const ops = yajsPath.operators();
    if (ops.length < 3) { return null; }
    if (ops[0].getType() !== PathOperator.Type.ROOT) { return null; }
    if (ops[1].getType() !== PathOperator.Type.DESCENDANT) { return null; }
    const keys: string[] = [];
    for (let i = 2; i < ops.length; i++) {
        const op = ops[i];
        if (op.getType() !== PathOperator.Type.OBJECT) { return null; }
        const cn = op as ChildNode;
        if (cn.filtered) { return null; }
        if (!SAFE_KEY.test(cn.key)) { return null; }
        keys.push(cn.key);
    }
    if (keys.length === 0) { return null; } // Descendant can't be the last operator (YAJSPath's own constructor already guarantees this - defensive)
    // Project/drop-keys aren't yet ported to this evaluator's own
    // collect/filter/emit design (they were previously reused from
    // ChainEvaluator, which this rewrite no longer calls into - see this
    // file's top comment) - fall back rather than silently drop them.
    if (yajsPath.dropKeys.length > 0 || yajsPath.projectKeys.length > 0) { return null; }

    return {
        targetKey: keys[0],
        targetNeedle: keyNeedle(keys[0]),
        suffixKeys: keys.slice(1),
        maxSpanBytes: options.hybridMaxSpanBytes > 0 ? options.hybridMaxSpanBytes : DEFAULT_MAX_SPAN_BYTES,
    };
}

/**
 * Native indexOf pre-filter: does `plan.targetNeedle` occur ANYWHERE in
 * [start,end)? A `true` result doesn't guarantee a real key occurrence
 * exists in there (the bytes could coincidentally appear inside an
 * unrelated string's content) - it only guards recursion, and structural
 * enumeration inside collectMatches() is what actually confirms a match.
 * A `false` result DOES guarantee no real occurrence exists - see
 * keyNeedle()'s own doc comment for why that direction is sound given
 * compileHybridPlan()'s key-charset restriction.
 */
function containsPossibleMatch(buf: SpanBuffer, needle: Buffer, start: number, end: number): boolean {
    return buf.indexOf(needle, start, end) !== -1;
}

/**
 * Top-level entry point: gathers every RAW candidate match for `plan`
 * found by treating [valueStart,valueEnd) as the value at `pathStack`
 * (with `keySpan` - the value's own object key bytes, or null for an
 * array element/bare top-level value - checked against the target key
 * first), appending them to `out`. Called once per fully-resolved
 * container entry, both by HybridFastPath.ts's resumable top-level driver
 * and by collectMatches()'s own recursion (see its doc comment for why
 * this shared entry point, not scanForMatches()'s old direct-emit
 * design, is what fixed the issue #14/#89 interaction bugs this file's
 * top comment references).
 */
export function collectEntryMatches(buf: SpanBuffer, keySpan: [number, number] | null, valueStart: number, valueEnd: number,
                                     pathStack: Array<string | number>, plan: HybridPlan, out: RawMatch[]): void {
    if (keySpan) {
        const [ks, ke] = keySpan;
        const keyLen = ke - ks;
        if (keyLen === plan.targetNeedle.length && buf.slice(ks, ke).equals(plan.targetNeedle)) {
            const cPath = pathStack.concat(plan.targetKey);
            // (a) direct suffix-chain hits from THIS target-key occurrence's
            // own value (empty suffix means the value itself, fanned out
            // per issue #14 if it's an array - see collectSuffixHits()).
            collectSuffixHits(buf, valueStart, valueEnd, plan.suffixKeys, 0, cPath.concat(plan.suffixKeys), out);
            // (b) the target key can also recur at any depth INSIDE this
            // same value (self-nesting, issue #89) - every such occurrence
            // is gathered too, exactly like any other nested target-key
            // search; innermost-only filtering (which of (a)/(b) survives)
            // happens later, over the whole collected set - see
            // filterInnermost().
            if (isContainerByte(buf.byteAt(valueStart)) && containsPossibleMatch(buf, plan.targetNeedle, valueStart, valueEnd)) {
                collectMatches(buf, valueStart, valueEnd, cPath, plan, out);
            }
            return;
        }
        if (isContainerByte(buf.byteAt(valueStart)) && containsPossibleMatch(buf, plan.targetNeedle, valueStart, valueEnd)) {
            const decodedKey = JSON.parse(buf.slice(ks, ke).toString('utf8'));
            collectMatches(buf, valueStart, valueEnd, pathStack.concat(decodedKey), plan, out);
        }
    } else if (isContainerByte(buf.byteAt(valueStart)) &&
               containsPossibleMatch(buf, plan.targetNeedle, valueStart, valueEnd)) {
        collectMatches(buf, valueStart, valueEnd, pathStack, plan, out);
    }
}

/**
 * Structurally walks the container (object or array) starting at `start`
 * (which must point at '{' or '[') looking for occurrences of
 * `plan.targetKey` anywhere inside, delegating each entry to
 * collectEntryMatches() above. `end` must be a CONCRETE, already-fully-
 * available offset - this function is entirely synchronous and never
 * itself waits for more bytes; HybridFastPath.ts's resumable top-level
 * driver is the only thing that ever calls into this evaluator on a range
 * it hasn't already confirmed is fully buffered (each individual entry's
 * own span is resolved, one at a time, via scanValueEnd() before
 * recursing), which is exactly what keeps this function simple: no
 * pause/resume state of its own to get wrong.
 *
 * `pathStack` is the decoded ancestor key-name chain from the document
 * root down to (not including) this container - array levels never
 * contribute a segment (mirrors YAJSPath's own array-transparency; see
 * ARCHITECTURE.md §3/§4).
 *
 * Throws HybridBailoutError for structurally malformed bytes (caller
 * routes the whole record to the real engine - see HybridFastPath.ts).
 */
function collectMatches(buf: SpanBuffer, start: number, end: number,
                         pathStack: Array<string | number>, plan: HybridPlan, out: RawMatch[]): void {
    const isObject = buf.byteAt(start) === OPEN_BRACE;
    const closeByte = isObject ? CLOSE_BRACE : CLOSE_BRACKET;
    let p = start + 1;
    for (;;) {
        p = skipWs(buf, p, end);
        if (p >= end) { throw new HybridBailoutError('unterminated container'); }
        const b = buf.byteAt(p);
        if (b === closeByte) { return; }
        let valueStart: number;
        if (isObject) {
            if (b !== QUOTE) { throw new HybridBailoutError('expected object key'); }
            const keyEnd = scanValueEnd(buf, p, end);
            if (keyEnd === -1) { throw new HybridBailoutError('unterminated object key'); }
            const c = skipWs(buf, keyEnd, end);
            if (c >= end || buf.byteAt(c) !== COLON) { throw new HybridBailoutError('expected \':\' after object key'); }
            valueStart = skipWs(buf, c + 1, end);
            if (valueStart >= end) { throw new HybridBailoutError('unterminated object entry'); }
            const valueEnd = scanValueEnd(buf, valueStart, end);
            if (valueEnd === -1) { throw new HybridBailoutError('unterminated object entry value'); }
            collectEntryMatches(buf, [p, keyEnd], valueStart, valueEnd, pathStack, plan, out);
            p = valueEnd;
        } else {
            valueStart = p;
            const valueEnd = scanValueEnd(buf, valueStart, end);
            if (valueEnd === -1) { throw new HybridBailoutError('unterminated array element'); }
            collectEntryMatches(buf, null, valueStart, valueEnd, pathStack, plan, out);
            p = valueEnd;
        }
        p = skipWs(buf, p, end);
        if (p >= end) { throw new HybridBailoutError('unterminated container'); }
        const b2 = buf.byteAt(p);
        if (b2 === COMMA) { p++; continue; }
        if (b2 === closeByte) { return; }
        throw new HybridBailoutError('expected \',\' or closing bracket');
    }
}

/**
 * Navigates `suffixKeys[idx..]` from the value at [start,end) exactly like
 * the shipped ChainEvaluator's own stepNoIdx() (FastPathEvaluator.ts) -
 * one level of array-transparency per pending key, duplicate object keys
 * each independently followed (byte-level structural scanning naturally
 * gives this "for free", unlike a JSON.parse'd object which can only ever
 * keep the last occurrence - a deliberate, small IMPROVEMENT in fidelity
 * over the shipped 'line' path's own documented JSON.parse divergence,
 * not a bug) - but reimplemented at the byte level (not over an
 * already-parsed JS value) because a RawMatch's own [start,end) span is
 * exactly what filterInnermost() needs to correctly resolve issue #89 for
 * this shape (see this file's own top comment) - a parsed-value walk
 * (ChainEvaluator's own) has no byte spans to compare.
 *
 * At the chain's own terminus (idx === suffixKeys.length), applies issue
 * #14's array fan-out exactly once (an array found here is flattened one
 * level; an element that's itself an array/object is pushed whole, not
 * further flattened).
 *
 * Array transparency is exactly ONE hop, not arbitrary depth - verified
 * against the real engine (`$..a.b` against `{"a":[[{"b":1}]]}` - two
 * array levels between "a" and "b" - matches NOTHING, not `b`'s value 1;
 * one array level does match). Mirrors ChainEvaluator's own stepNoIdx()
 * (FastPathEvaluator.ts) exactly: an array element continues the SAME
 * pending-key search only if the element is itself a plain object (its
 * own `isPlainObject(el)` check) - an element that's itself another array
 * is a dead end for this hop, not a second transparent hop.
 */
function collectSuffixHits(buf: SpanBuffer, start: number, end: number, suffixKeys: string[], idx: number,
                            path: Array<string | number>, out: RawMatch[]): void {
    if (idx === suffixKeys.length) {
        if (buf.byteAt(start) === OPEN_BRACKET) {
            forEachArrayElement(buf, start, end, (elStart, elEnd) => out.push({ path, start: elStart, end: elEnd }));
        } else {
            out.push({ path, start, end });
        }
        return;
    }
    const c = buf.byteAt(start);
    if (c === OPEN_BRACE) {
        forEachObjectEntry(buf, start, end, (keyStart, keyEnd, valueStart, valueEnd) => {
            const keyLen = keyEnd - keyStart;
            const wantLen = suffixKeys[idx].length + 2; // quotes
            if (keyLen === wantLen && buf.slice(keyStart, keyEnd).toString('utf8') === JSON.stringify(suffixKeys[idx])) {
                collectSuffixHits(buf, valueStart, valueEnd, suffixKeys, idx + 1, path, out);
            }
        });
    } else if (c === OPEN_BRACKET) {
        forEachArrayElement(buf, start, end, (elStart, elEnd) => {
            if (buf.byteAt(elStart) === OPEN_BRACE) { // one hop only - see this function's own doc comment
                collectSuffixHits(buf, elStart, elEnd, suffixKeys, idx, path, out);
            }
        });
    }
    // scalar mid-chain, or a nested array (one-hop limit already spent):
    // dead end, nothing to collect
}

/** Enumerates the byte spans of an object's own immediate (key,value)
 * entries (the object at [start,end) is assumed well-formed and fully
 * available - same preconditions as collectMatches()). */
function forEachObjectEntry(buf: SpanBuffer, start: number, end: number,
                             cb: (keyStart: number, keyEnd: number, valueStart: number, valueEnd: number) => void): void {
    let p = start + 1;
    for (;;) {
        p = skipWs(buf, p, end);
        if (p >= end) { throw new HybridBailoutError('unterminated object'); }
        if (buf.byteAt(p) === CLOSE_BRACE) { return; }
        if (buf.byteAt(p) !== QUOTE) { throw new HybridBailoutError('expected object key'); }
        const keyEnd = scanValueEnd(buf, p, end);
        if (keyEnd === -1) { throw new HybridBailoutError('unterminated object key'); }
        const c = skipWs(buf, keyEnd, end);
        if (c >= end || buf.byteAt(c) !== COLON) { throw new HybridBailoutError('expected \':\' after object key'); }
        const valueStart = skipWs(buf, c + 1, end);
        if (valueStart >= end) { throw new HybridBailoutError('unterminated object entry'); }
        const valueEnd = scanValueEnd(buf, valueStart, end);
        if (valueEnd === -1) { throw new HybridBailoutError('unterminated object entry value'); }
        cb(p, keyEnd, valueStart, valueEnd);
        const p2 = skipWs(buf, valueEnd, end);
        if (p2 >= end) { throw new HybridBailoutError('unterminated object'); }
        const b = buf.byteAt(p2);
        if (b === COMMA) { p = p2 + 1; continue; }
        if (b === CLOSE_BRACE) { return; }
        throw new HybridBailoutError('expected \',\' or \'}\'');
    }
}

/** Enumerates the byte spans of an array's own immediate elements (the
 * array at [start,end) is assumed well-formed and fully available - same
 * preconditions as collectMatches()). */
function forEachArrayElement(buf: SpanBuffer, start: number, end: number,
                              cb: (elStart: number, elEnd: number) => void): void {
    let p = start + 1;
    for (;;) {
        p = skipWs(buf, p, end);
        if (p >= end) { throw new HybridBailoutError('unterminated array'); }
        if (buf.byteAt(p) === CLOSE_BRACKET) { return; }
        const elStart = p;
        const elEnd = scanValueEnd(buf, elStart, end);
        if (elEnd === -1) { throw new HybridBailoutError('unterminated array element'); }
        cb(elStart, elEnd);
        p = skipWs(buf, elEnd, end);
        if (p >= end) { throw new HybridBailoutError('unterminated array'); }
        const b = buf.byteAt(p);
        if (b === COMMA) { p++; continue; }
        if (b === CLOSE_BRACKET) { return; }
        throw new HybridBailoutError('expected \',\' or \']\'');
    }
}

/**
 * Issue #89: keeps only the "leaf" matches - a RawMatch is discarded iff
 * some OTHER collected match's own span is entirely contained within its
 * value span (i.e. something is nested inside it, so it's an outer
 * occurrence superseded by a deeper one - see the real engine's own
 * discard-and-replace, StreamContext.ts's `innermostOnDescendantKey`).
 * Two matches with no containment relation either way (disjoint branches,
 * including ones that merely share a repeated ancestor key without one's
 * value actually containing the other's - see this file's top comment for
 * the concrete `$..c.a` repro this distinction fixes) both survive
 * untouched, matching #89's own required invariant that non-nested
 * matches are a complete no-op for this filter.
 *
 * O(n log n), not the naive O(n^2) pairwise check this replaced - matters
 * because this runs over every match FOUND IN ONE TOP-LEVEL RECORD (see
 * HybridFastPath.ts's own per-record batching), and this evaluator's own
 * headline "whale record" case (one huge top-level document) can
 * legitimately collect a large number of matches for that one record.
 * Every RawMatch span is a JSON value's own byte range, so any two of
 * them are either disjoint or one strictly contains the other (never a
 * partial overlap) - a laminar family - which is what makes a single
 * sorted pass sufficient: sort by start ascending (ties broken by end
 * descending, so an outer span sorts before an inner one that happens to
 * start at the same offset), then track "currently open" ancestors on a
 * stack; pushing a new span onto a non-empty stack marks the span
 * beneath it (its immediate enclosing match) as superseded - and
 * transitively, that beneath match's own ancestors already got marked
 * the same way when IT was pushed, so one propagation step per push is
 * enough. A span is popped (and kept only if never marked) once the next
 * span to process starts at or after its own end, i.e. it's confirmed
 * closed with nothing left that could nest inside it.
 */
function filterInnermost(matches: RawMatch[]): RawMatch[] {
    if (matches.length <= 1) { return matches; }
    const sorted = matches.slice().sort((a, b) => (a.start - b.start) || (b.end - a.end));
    const survivors: RawMatch[] = [];
    const stack: Array<{ m: RawMatch; superseded: boolean }> = [];
    const popClosed = (beforeStart: number) => {
        while (stack.length > 0 && stack[stack.length - 1].m.end <= beforeStart) {
            const frame = stack.pop();
            if (!frame.superseded) { survivors.push(frame.m); }
        }
    };
    for (const m of sorted) {
        popClosed(m.start);
        if (stack.length > 0) { stack[stack.length - 1].superseded = true; }
        stack.push({ m, superseded: false });
    }
    popClosed(Infinity);
    return survivors;
}

/**
 * Finalizes one collected batch (see HybridFastPath.ts - called once per
 * fully-resolved top-level entry, after collectEntryMatches() has
 * gathered every raw candidate for it): applies filterInnermost(), then
 * JSON.parse()s and emits each survivor. Project/drop-keys are out of
 * scope for this evaluator (compileHybridPlan() already declines to
 * compile a selector that uses them - see its own comment), so emission
 * here is a plain JSON.parse of each survivor's own span.
 *
 * Two passes, deliberately: every survivor is validated (size cutoff) and
 * JSON.parse()d FIRST, into `parsedValues`, before any is emitted - a
 * later survivor tripping HybridBailoutError must never leave an EARLIER
 * one in this same batch already delivered to the caller. Without this,
 * HybridFastPath.ts's bailout handling (which relays the WHOLE current
 * top-level entry to the real engine, re-producing every one of its
 * matches independently) would double-emit whatever this function had
 * already emitted before the throw - the same class of bug this file's
 * top comment already documents fixing once (the collect/filter/emit
 * split itself); this is that same invariant, one call deeper.
 */
export function emitCollectedMatches(buf: SpanBuffer, matches: RawMatch[], plan: HybridPlan, emit: EmitFn): void {
    const survivors = filterInnermost(matches);
    const parsedValues: any[] = new Array(survivors.length);
    for (let i = 0; i < survivors.length; i++) {
        const m = survivors[i];
        if (m.end - m.start > plan.maxSpanBytes) {
            throw new HybridBailoutError(`matched span (${m.end - m.start} bytes) exceeds hybridMaxSpanBytes`);
        }
        try {
            parsedValues[i] = JSON.parse(buf.slice(m.start, m.end).toString('utf8'));
        } catch (e) {
            throw new HybridBailoutError(`matched span failed to JSON.parse: ${(e as Error).message}`);
        }
    }
    for (let i = 0; i < survivors.length; i++) {
        emit(survivors[i].path, parsedValues[i]);
    }
}
