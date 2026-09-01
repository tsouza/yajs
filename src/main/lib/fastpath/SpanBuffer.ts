// Low-level byte-scanning primitives for the SKIP/PARSE/DESCEND span-parsing
// hybrid fast path (issues #79/#87). See HybridSpanEvaluator.ts for how
// these compose into an actual selector-driven scanner, and
// HybridFastPath.ts for the stream orchestrator that feeds bytes in here.
//
// Everything in this file operates on raw bytes only - no UTF-8 decoding.
// That's deliberate and safe: every byte this module ever branches on
// ('"', '\\', '{', '}', '[', ']', ':', ',', and ASCII whitespace) is below
// 0x80, and no byte of a multi-byte UTF-8 sequence (lead bytes 0xC0-0xFF,
// continuation bytes 0x80-0xBF) can ever equal one of those - so scanning
// raw bytes can never misinterpret a UTF-8 character as JSON structure, and
// never needs a character to be complete in the buffer to make a correct
// structural decision (only string *content* bytes are decoded, and only
// once a full byte span has already been isolated, at JSON.parse() time).
'use strict';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;

function isWs(b: number): boolean {
    return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
}

/**
 * A growable, compactable byte buffer addressed by ABSOLUTE stream offsets
 * (not relative to whatever's currently retained) - the offset space is
 * stable across compaction, so callers (HybridSpanEvaluator's scan state)
 * can hold onto offsets from before a compact() without adjustment.
 *
 * append() amortizes to O(1) via geometric growth (classic dynamic-array
 * doubling). compact() is caller-driven rather than automatic: scanning
 * only knows a byte range is safely discardable once a value's end (or a
 * containment decision) has been resolved - see HybridSpanEvaluator's
 * minSafeOffset() - so it explicitly tells this buffer when to drop a
 * prefix, instead of this class guessing.
 */
export class SpanBuffer {

    private buf: Buffer;
    private len = 0;
    // Absolute offset that buf[0] currently represents. Bytes before this
    // offset have been compact()ed away and are gone for good.
    private dropped = 0;

    constructor(initialCapacity = 64 * 1024) {
        this.buf = Buffer.allocUnsafe(Math.max(initialCapacity, 64));
    }

    /** Absolute offset one past the last byte currently available. */
    get end(): number {
        return this.dropped + this.len;
    }

    /** Absolute offset of the earliest byte still retained. */
    get start(): number {
        return this.dropped;
    }

    append(chunk: Buffer): void {
        if (chunk.length === 0) { return; }
        const needed = this.len + chunk.length;
        if (needed > this.buf.length) {
            let newCap = this.buf.length * 2;
            while (newCap < needed) { newCap *= 2; }
            const next = Buffer.allocUnsafe(newCap);
            this.buf.copy(next, 0, 0, this.len);
            this.buf = next;
        }
        chunk.copy(this.buf, this.len);
        this.len += chunk.length;
    }

    /** Raw byte at an absolute offset. Caller must ensure it's available. */
    byteAt(abs: number): number {
        return this.buf[abs - this.dropped];
    }

    /** A view (zero-copy) over [absStart, absEnd) of currently available bytes. */
    slice(absStart: number, absEnd: number): Buffer {
        return this.buf.subarray(absStart - this.dropped, absEnd - this.dropped);
    }

    /**
     * Native indexOf for `needle`, scanning [fromAbs, toAbs) of currently
     * available bytes (toAbs defaults to everything available). Returns an
     * absolute offset, or -1.
     */
    indexOf(needle: Buffer, fromAbs: number, toAbs?: number): number {
        const localTo = (toAbs === undefined ? this.len : toAbs - this.dropped);
        // Buffer#indexOf has no "search within [from,to)" form - clamp via a
        // subarray view (zero-copy) instead of scanning past `toAbs` and
        // discarding hits, so a caller-supplied frame boundary is honored
        // exactly (needed so one candidate's search never reads into, or
        // reports a hit belonging to, its *enclosing* frame's remainder).
        const view = localTo === this.len ? this.buf.subarray(0, this.len) : this.buf.subarray(0, localTo);
        const idx = view.indexOf(needle, fromAbs - this.dropped);
        return idx === -1 ? -1 : idx + this.dropped;
    }

    /**
     * Discards every byte before `absOffset`. Only actually copies when the
     * wasted prefix is a meaningful fraction of the live buffer, so a
     * stream of many small compact() calls (one per resolved candidate)
     * doesn't repeatedly re-copy a long-lived unconsumed tail - amortized
     * cost stays proportional to bytes actually consumed, not to how many
     * times compact() is called.
     */
    compact(absOffset: number): void {
        const cut = absOffset - this.dropped;
        if (cut <= 0) { return; }
        if (cut >= this.len) {
            this.dropped += this.len;
            this.len = 0;
            return;
        }
        if (cut < 1024 && cut < this.buf.length / 4) { return; }
        this.buf.copy(this.buf, 0, cut, this.len);
        this.len -= cut;
        this.dropped += cut;
    }
}

/**
 * Finds the exclusive end offset of the JSON value beginning at `start`
 * (which must point at a non-whitespace byte - the value's first byte).
 * Quote/escape-aware for strings, depth-counting (skipping over string
 * contents) for objects/arrays, delimiter-scanning for bare scalars
 * (number/true/false/null).
 *
 * Returns -1 if the value's end isn't yet determinable from bytes
 * available up to `limit` (exclusive) - the caller should retry once more
 * bytes have arrived. Throws only for a structural impossibility that no
 * amount of further input could fix (a stray closing bracket, or a
 * container that closes with the wrong bracket type) - genuinely malformed
 * input, which callers route to the real streaming engine instead of
 * trying to recover from here (same "don't reimplement error recovery"
 * philosophy as NdjsonFastPath's own fallback).
 *
 * Re-scans from `start` on every call rather than resuming from
 * previously-seen internal state - deliberately simple (no cross-call
 * state to get subtly wrong) since a matched value's byte span is, by this
 * feature's own design, expected to be small relative to the surrounding
 * document (see ARCHITECTURE.md's "only ever buffers the matched span"
 * framing) - a handful of retries against a growing buffer is cheap; see
 * README's Performance notes for the one documented case (a single
 * enormous matched value) where this stops being true and
 * hybridMaxSpanBytes routes the record to the real engine instead.
 */
export function scanValueEnd(buf: SpanBuffer, start: number, limit: number): number {
    if (start >= limit) { return -1; }
    const c = buf.byteAt(start);
    if (c === QUOTE) {
        // Non-standard `"""triple-quoted"""` extension (see
        // JsonSaxParser.ts's TDQSTR* states): this function only
        // understands standard JSON strings, so an apparent EMPTY string
        // (`""`, closing quote found with zero content) is deliberately
        // NOT trusted at face value until the byte right after it is
        // confirmed to not be a third '"' - genuinely needing more bytes
        // to decide returns -1 (never misreported as "closed"), and a
        // confirmed third quote throws rather than silently misreading a
        // triple-quoted value as an empty string followed by garbage
        // (which would have let considerEntry() emit a wrong match before
        // the surrounding container's own syntax check ever catches the
        // problem - the bailout has to happen HERE, before any span this
        // string is part of is treated as resolved, not one step later).
        if (start + 1 < limit && buf.byteAt(start + 1) === QUOTE) {
            if (start + 2 >= limit) { return -1; }
            if (buf.byteAt(start + 2) === QUOTE) {
                throw new Error('triple-quoted string extension not supported by the hybrid span scanner');
            }
            return start + 2; // genuine empty string ""
        }
        let i = start + 1;
        for (; i < limit; i++) {
            const b = buf.byteAt(i);
            if (b === BACKSLASH) { i++; continue; }
            if (b === QUOTE) { return i + 1; }
        }
        return -1;
    }
    if (c === OPEN_BRACE || c === OPEN_BRACKET) {
        // Depth-only counting (no bracket-type stack): correct by
        // construction for well-formed JSON, where brackets always nest
        // properly, so type-mismatched input (`{"a": [1, 2}`) isn't
        // specially detected here - it's still caught downstream, either
        // by JSON.parse() rejecting the resulting span at materialization
        // time, or by never reaching depth 0 and surfacing as an
        // end-of-stream "incomplete" error. Either way malformed input
        // routes to the real engine (see HybridFastPath.ts) rather than
        // this function trying to diagnose it precisely.
        let depth = 0;
        let inString = false;
        for (let i = start; i < limit; i++) {
            const b = buf.byteAt(i);
            if (inString) {
                if (b === BACKSLASH) { i++; continue; }
                if (b === QUOTE) { inString = false; }
                continue;
            }
            if (b === QUOTE) { inString = true; continue; }
            if (b === OPEN_BRACE || b === OPEN_BRACKET) { depth++; continue; }
            if (b === CLOSE_BRACE || b === CLOSE_BRACKET) {
                depth--;
                if (depth === 0) { return i + 1; }
                if (depth < 0) { throw new Error(`unbalanced container at byte ${i}`); }
            }
        }
        return -1;
    }
    // Bare scalar (number/true/false/null): ends at the next structural
    // delimiter or whitespace byte. A scalar that is the very last thing in
    // the stream (no trailing delimiter ever comes - e.g. a bare top-level
    // NDJSON record with no final newline, `{"a":1}\n42`) can never be
    // disambiguated from "still arriving" by this function alone: it keeps
    // returning -1 forever. HybridFastPath.ts's own top-level driver
    // treats that as "malformed" once truly at end-of-stream (same as any
    // other never-resolved span) and falls back to the real engine for it
    // - correct, just not the fast path, for that one edge case (see
    // src/test/13-hybrid-fastpath.ts's "a trailing bare top-level scalar
    // with no final delimiter still falls back correctly" case).
    let i = start;
    for (; i < limit; i++) {
        const b = buf.byteAt(i);
        if (b === COMMA || b === CLOSE_BRACE || b === CLOSE_BRACKET || isWs(b)) {
            return i;
        }
    }
    return -1;
}

/**
 * Byte-exact needle for an object key occurrence: `"<key>"`, JSON-escaped
 * once at plan-compile time (see HybridSpanEvaluator.compileHybridPlan()).
 * Used only as a fast native pre-filter ("could this span possibly contain
 * the target key anywhere inside it?" - see HybridSpanEvaluator.ts's
 * containsPossibleMatch()) to decide whether a subtree is worth
 * structurally recursing into at all. A false POSITIVE here (the byte
 * pattern occurs but not as a real key - e.g. inside an unrelated string's
 * content) only costs a wasted recursion that structural enumeration then
 * correctly finds nothing in - never a correctness issue, so this needle
 * deliberately does NOT need the escape/colon-adjacency validation a
 * *sole* detection mechanism would (contrast the throwaway spike's
 * indexOf-only design). The one thing it must not do is produce a false
 * NEGATIVE for the plan's own target/suffix keys - see
 * compileHybridPlan()'s charset restriction for why that's guaranteed
 * here (restricted to a charset with exactly one valid JSON encoding).
 */
export function keyNeedle(key: string): Buffer {
    return Buffer.from(JSON.stringify(key), 'utf8');
}
