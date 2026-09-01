// Stream orchestrator for the SKIP/PARSE/DESCEND span-parsing hybrid
// (issues #79/#87). Owns the one piece of genuinely resumable (chunk-
// crossing) state this feature needs: finding the boundaries of
// successive TOP-LEVEL JSON values as bytes arrive, incrementally, so a
// single enormous top-level document (the "whale record" case - see
// README's Performance section) never needs to be buffered whole before
// this can make progress. Everything below the top level is handled by
// HybridSpanEvaluator.ts's collectEntryMatches()/emitCollectedMatches(),
// which are deliberately synchronous and non-resumable - see their own
// doc comments for why that's safe (every span they're asked to scan is
// already known, by construction, to be fully buffered).
//
// Unlike NdjsonFastPath.ts, there's no `\n`-splitting here at all - see
// #87's own scope note (quoted in HybridSpanEvaluator.ts's top comment)
// for why: this design finds top-level value boundaries structurally
// (bracket/quote/escape-aware), which also means it works on input that
// isn't one-record-per-line (a single multi-gigabyte top-level document,
// or a pretty-printed one spanning many physical lines) without the
// shipped path's own "falls back to the real engine for anything spanning
// multiple lines" caveat.
//
// Three ways this ends up NOT giving the hybrid's own speedup, all
// correct-by-construction (never a wrong answer, only a slower one):
//
//  1. The selector's shape isn't one compileHybridPlan() supports (see
//     HybridSpanEvaluator.ts's own scope note) - decided once, at
//     construction, from the compiled YAJSPath alone. This constructor
//     delegates 100% of write()/end() to a real NdjsonFastPath instance
//     for the rest of the stream's life - reusing that already-tested
//     machinery outright rather than reimplementing any part of it.
//  2. A HybridBailoutError is thrown mid-stream (malformed bytes, or one
//     matched span over `hybridMaxSpanBytes`) - permanently switches this
//     one stream to relaying everything from that point to EOF through
//     the real streaming engine (JsonSaxParser+StreamContext, the exact
//     same createFallbackEngine factory NdjsonFastPath.ts's own caller in
//     yajs.ts already builds). Deliberately simpler than
//     NdjsonFastPath.ts's own relay design: no attempt to resync at a
//     record boundary and resume fast-path scanning afterward - since
//     this design never splits input into independent records to begin
//     with (see this file's own top comment), "the next record boundary"
//     isn't a concept this path has. A single malformed byte anywhere
//     costs the rest of the stream's hybrid speedup; genuinely malformed
//     NDJSON is expected to be rare enough for opt-in `fastPath: 'hybrid'`
//     input that this is an acceptable, documented trade-off (see
//     README).
//  3. A structurally valid document whose matched value's own span is
//     larger than `hybridMaxSpanBytes` (default 8 MiB, matching the
//     shipped path's own `fastPathMaxRecordBytes` default) - same
//     bailout as (2). This is the one place hybrid mode's own "no
//     per-record size cutoff" property (see this repo's issue #87) has a
//     real edge: the cutoff here is scoped to one MATCHED SPAN, not the
//     whole record, so a whale record whose actual matches stay modest in
//     size - true of every bench dataset in this repo, see README's
//     Performance section - never trips it at all, even though the
//     record containing them is enormous.
'use strict';

import { YAJSPath } from '../path/YAJSPath';
import { EmitFn } from './FastPathEvaluator';
import { collectEntryMatches, compileHybridPlan, emitCollectedMatches, HybridBailoutError, HybridPlan, RawMatch } from './HybridSpanEvaluator';
import { FallbackEngine, NdjsonFastPath, NdjsonFastPathOptions } from './NdjsonFastPath';
import { scanValueEnd, SpanBuffer } from './SpanBuffer';

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

function skipWs(buf: SpanBuffer, from: number, end: number): number {
    let i = from;
    while (i < end && isWs(buf.byteAt(i))) { i++; }
    return i;
}

export interface HybridFastPathOptions extends NdjsonFastPathOptions {
    /**
     * Per-MATCHED-SPAN size cutoff, in bytes of the matched value's own
     * raw text - above which that one record is routed to the real
     * streaming engine instead of ever materializing the match as a
     * JS string/JSON.parse tree. Unlike `fastPathMaxRecordBytes`, this is
     * NOT a whole-record cutoff (see this file's own top comment, point
     * 3) - a record can be arbitrarily large as long as no single matched
     * value within it exceeds this. Defaults to 8 MiB.
     */
    hybridMaxSpanBytes?: number;
}

interface ActiveContainer {
    kind: 'object' | 'array';
    pos: number;
    awaitingEntryStart: boolean;
}

/**
 * Entry point used by yajs.ts for `fastPath: 'hybrid'`. See this file's
 * own top comment for the three ways this transparently defers to
 * existing, already-tested machinery instead of the new span-scanning
 * path; see HybridSpanEvaluator.ts for the matching engine itself.
 */
export class HybridFastPath {

    private readonly plan: HybridPlan | null;
    private readonly delegate: NdjsonFastPath | null;
    private readonly buf = new SpanBuffer();
    private cursor = 0;
    private active: ActiveContainer | null = null;
    private sawAnyValue = false;
    // Raw matches collected so far for the CURRENT top-level record - see
    // advance()'s own comment on why emission is deferred to the record's
    // whole close rather than done per entry. Always empty except while
    // this.active is non-null (a record is being actively enumerated);
    // discarded, never flushed, on startBailout().
    private pendingMatches: RawMatch[] = [];

    private bailedOut = false;
    private fallback: FallbackEngine | null = null;

    constructor(yajsPath: YAJSPath, options: HybridFastPathOptions, private readonly emit: EmitFn,
                reportError: (err: Error) => void,
                private readonly createFallbackEngine: (onBoundary: () => void) => FallbackEngine) {
        this.plan = compileHybridPlan(yajsPath, options);
        this.delegate = this.plan ? null : new NdjsonFastPath(yajsPath, options, emit, reportError, createFallbackEngine);
    }

    write(chunk: Buffer): void {
        if (this.delegate) { this.delegate.write(chunk); return; }
        if (this.bailedOut) { this.relay(chunk); return; }
        this.buf.append(chunk);
        try {
            this.advance(false);
        } catch (e) {
            this.startBailout(e instanceof Error ? e : new Error(String(e)));
        }
    }

    end(): void {
        if (this.delegate) { this.delegate.end(); return; }
        if (this.bailedOut) { this.fallback.finish(); return; }
        try {
            this.advance(true);
            if (this.active !== null) {
                throw new HybridBailoutError('unexpected end of input inside a container');
            }
        } catch (e) {
            this.startBailout(e instanceof Error ? e : new Error(String(e)));
            this.fallback.finish();
            return;
        }
        if (!this.sawAnyValue) {
            // Replicate the default engine's "no data" error for empty/
            // whitespace-only input - see NdjsonFastPath.ts's identical
            // end() handling and its own comment for why a virgin fallback
            // engine is the simplest way to get an identical error.
            this.ensureFallback();
            this.fallback.finish();
        }
    }

    // Makes as much progress as currently possible, emitting resolved
    // matches as it goes. Returns (rather than throwing) once it needs
    // more bytes than are currently available - `atEnd` distinguishes
    // that from a genuine end-of-stream, at which point "needs more
    // bytes" instead means "truncated/malformed" (thrown).
    private advance(atEnd: boolean): void {
        for (;;) {
            if (this.active === null) {
                const p = skipWs(this.buf, this.cursor, this.buf.end);
                this.cursor = p;
                if (p >= this.buf.end) { return; }
                const b = this.buf.byteAt(p);
                if (b === OPEN_BRACE || b === OPEN_BRACKET) {
                    this.sawAnyValue = true;
                    this.active = { kind: b === OPEN_BRACE ? 'object' : 'array', pos: p + 1, awaitingEntryStart: true };
                    continue;
                }
                // Bare top-level scalar (number/string/true/false/null):
                // can't itself hold a descendant match - just skip past it
                // to find where the next top-level value starts.
                const e = scanValueEnd(this.buf, p, this.buf.end);
                if (e === -1) {
                    if (atEnd) { throw new HybridBailoutError('unterminated top-level value'); }
                    return;
                }
                this.sawAnyValue = true;
                this.cursor = e;
                this.buf.compact(this.cursor);
                continue;
            }

            const fr = this.active;
            const closeByte = fr.kind === 'object' ? CLOSE_BRACE : CLOSE_BRACKET;
            const p0 = skipWs(this.buf, fr.pos, this.buf.end);
            if (p0 >= this.buf.end) {
                fr.pos = p0;
                if (atEnd) { throw new HybridBailoutError('unterminated container'); }
                return;
            }
            const b0 = this.buf.byteAt(p0);

            if (fr.awaitingEntryStart) {
                if (b0 === closeByte) {
                    this.active = null;
                    // Flush BEFORE moving this.cursor past this record:
                    // flushPendingMatches() can throw (HybridBailoutError -
                    // an oversized/malformed match), and startBailout()
                    // relays from this.cursor - it must still point at
                    // THIS record's own start when that happens, or the
                    // record would be silently skipped entirely (never
                    // emitted by hybrid, since the throw pre-empted that,
                    // and never relayed either, since cursor had already
                    // moved past it). Only commit the advance past this
                    // record - and only then compact(), which depends on
                    // it - once the flush has actually succeeded.
                    this.flushPendingMatches();
                    this.cursor = p0 + 1;
                    this.buf.compact(this.cursor);
                    continue;
                }
                let keySpan: [number, number] | null = null;
                let valueStart: number;
                if (fr.kind === 'object') {
                    if (b0 !== QUOTE) { throw new HybridBailoutError('expected object key'); }
                    const keyEnd = scanValueEnd(this.buf, p0, this.buf.end);
                    if (keyEnd === -1) { fr.pos = p0; if (atEnd) { throw new HybridBailoutError('unterminated object key'); } return; }
                    const c = skipWs(this.buf, keyEnd, this.buf.end);
                    if (c >= this.buf.end) { fr.pos = p0; if (atEnd) { throw new HybridBailoutError('unterminated object entry'); } return; }
                    if (this.buf.byteAt(c) !== COLON) { throw new HybridBailoutError('expected \':\' after object key'); }
                    const vs0 = skipWs(this.buf, c + 1, this.buf.end);
                    if (vs0 >= this.buf.end) { fr.pos = p0; if (atEnd) { throw new HybridBailoutError('unterminated object entry'); } return; }
                    keySpan = [p0, keyEnd];
                    valueStart = vs0;
                } else {
                    valueStart = p0;
                }
                const valueEnd = scanValueEnd(this.buf, valueStart, this.buf.end);
                if (valueEnd === -1) {
                    fr.pos = p0;
                    if (atEnd) { throw new HybridBailoutError('unterminated container entry value'); }
                    return;
                }
                // Non-null: advance() only ever runs while this.delegate is
                // null, which the constructor guarantees only when
                // this.plan compiled successfully. Collect this entry's
                // raw candidate matches into this.pendingMatches - NOT
                // emitted yet. Emission is deferred to the WHOLE top-level
                // record's own close (see below) rather than done per
                // entry: a bailout partway through a LATER entry of the
                // same record relays the record from its own start (see
                // startBailout()), which would re-produce - and so
                // double-emit - any EARLIER entry's matches in this same
                // record if they'd already been emitted here. Buffering
                // matches (small; bounded by this one record's own match
                // count, not its byte size) rather than raw bytes keeps
                // this cheap even for a "whale record" (see this file's
                // own top comment, point 3).
                collectEntryMatches(this.buf, keySpan, valueStart, valueEnd, [], this.plan!, this.pendingMatches);
                fr.pos = valueEnd;
                fr.awaitingEntryStart = false;
                // Safe to compact only up to the EARLIEST still-pending
                // match's own start (if any) - its bytes are needed later,
                // at this record's own close, to JSON.parse() it (see
                // flushPendingMatches()) - never past that, even though
                // this entry's own [valueStart,valueEnd) has otherwise been
                // fully consumed. pendingMatches accumulates in increasing
                // start-offset order (entries are found left-to-right), so
                // its first element is always the earliest.
                this.buf.compact(this.pendingMatches.length > 0 ? Math.min(this.pendingMatches[0].start, valueEnd) : valueEnd);
                continue;
            }

            if (b0 === COMMA) { fr.pos = p0 + 1; fr.awaitingEntryStart = true; continue; }
            if (b0 === closeByte) {
                this.active = null;
                // Flush before moving this.cursor - see the other
                // close-branch's own comment above for why the order
                // matters.
                this.flushPendingMatches();
                this.cursor = p0 + 1;
                this.buf.compact(this.cursor);
                continue;
            }
            throw new HybridBailoutError('expected \',\' or closing bracket');
        }
    }

    // Permanently switches this stream to relaying every remaining byte
    // (whatever's still buffered here, plus everything future write()
    // calls bring) to a real engine instance - see this file's own top
    // comment, point 2, for why no resync-and-resume is attempted.
    //
    // Deliberately does NOT itself call reportError(): a HybridBailoutError
    // is an internal routing signal, not a user-visible failure - some
    // triggers (a matched span over hybridMaxSpanBytes) aren't malformed
    // input at all, just too large to keep handling inline, exactly like
    // fastPathMaxRecordBytes's silent re-routing in the shipped 'line'
    // path. `this.cursor` still points at the START of the current
    // top-level value even mid-container (see advance() - it only moves
    // once a container fully closes), and everything from there onward is
    // guaranteed still buffered (compact() never discards past it while a
    // container is active) - so the real engine gets that whole record
    // from a clean boundary and reports its own error independently if
    // the bytes genuinely are malformed, the same single error a
    // non-fastPath run of this input would produce.
    private startBailout(_err: Error): void {
        this.bailedOut = true;
        // Discard, never flush: this.cursor (below) still points at the
        // CURRENT record's own start, so the fallback engine is about to
        // reproduce this record's matches independently - anything still
        // pending here belongs to that same, not-yet-fully-processed
        // record and would otherwise be double-emitted.
        this.pendingMatches = [];
        this.ensureFallback();
        const remaining = this.buf.slice(this.cursor, this.buf.end);
        if (remaining.length > 0) { this.fallback.write(Buffer.from(remaining)); }
    }

    // Applies issue #89 innermost-only filtering across ALL matches
    // collected for the record that just closed, then emits the
    // survivors - see advance()'s own comment for why this is deferred to
    // the whole record's close rather than done per entry.
    private flushPendingMatches(): void {
        if (this.pendingMatches.length === 0) { return; }
        const matches = this.pendingMatches;
        this.pendingMatches = [];
        emitCollectedMatches(this.buf, matches, this.plan!, this.emit);
    }

    private relay(chunk: Buffer): void {
        this.fallback.write(chunk);
    }

    private ensureFallback(): void {
        if (!this.fallback) {
            // onBoundary is a no-op: this stream never returns to fast-path
            // scanning once bailed out (see this file's top comment), so
            // there's nothing for it to resume.
            this.fallback = this.createFallbackEngine(() => { /* no-op */ });
        }
    }
}
