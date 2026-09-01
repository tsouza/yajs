// Array-splitter fast path (issue #86, extending the NDJSON line/chain fast
// path from issue #78/NdjsonFastPath.ts): treats a top-level JSON array as
// "comma-delimited NDJSON" - a lightweight quote/escape/depth-aware
// structural byte scanner finds each depth-1 element's raw text span
// (chunk-boundary safe, exactly like NdjsonFastPath's own line accumulation)
// and hands each one to native `JSON.parse` plus the same compiled-selector
// evaluator (FastPathEvaluator.ts) NdjsonFastPath uses - no byte-by-byte
// SAX tokenization for the array's own structure.
//
// ## Why this needs its own class rather than reusing NdjsonFastPath
//
// NdjsonFastPath's records are independent top-level documents: a fallback
// for one record never affects any other record's evaluation, because each
// one starts fresh at the document root (StreamPosition has no state to
// carry between them). An array-splitter's *elements* are NOT independent
// in that sense - they all share one running position (the array's own
// element index), which matters in two ways: it is part of the emitted
// `path` when `pathIncludeArrayIndex` is on, AND (more subtly) it can gate
// *matching itself* for a selector with an explicit array-index operator
// (e.g. `$[2].field`) at the root. Skipping an element (evaluating it via
// a completely separate, independently-positioned real engine, the way
// NdjsonFastPath treats an oversized/malformed record) would desync that
// shared index for every element after it.
//
// ## The design: whole-array-remainder fallback, not per-record fallback
//
// Because of that shared state, this class does NOT attempt NdjsonFastPath's
// "one bad record falls back, the rest of the stream stays fast" resumption.
// Instead: the structural scanner keeps finding element boundaries
// correctly (it is quote/escape/depth-aware, so it can locate the *end* of
// an element regardless of whether that element's content is something
// `JSON.parse` accepts) for every element up to and including the first one
// that can't be fast-pathed (see triggerFallback's three call sites below);
// from THAT element onward, this array's remaining raw bytes - reconstructed
// as a synthetic `[...]` wrapping the still-unconsumed content, so the real
// engine sees correct array-transparency context for matching - are relayed
// verbatim to one real engine instance for the rest of the array (never
// resumed), with each of ITS emitted paths rebased (`path[0] += <elements
// already fast-consumed>`) before reaching the caller's `emit`, so indices
// stay correct across the handoff. Once the real, original `]` is found
// (the scanner keeps tracking bracket depth through the relay to know
// exactly where that is), rebasing stops and everything after - including
// any further top-level values in the stream - is relayed unwrapped,
// permanently, by the same engine instance (ordinary multi-document
// behavior, identical to `fastPath: false`).
//
// This is a deliberate scope trade-off, not an oversight: resuming fast-path
// per-element (like NdjsonFastPath) would require re-synchronizing the
// shared array-index state after every fallback, which is real additional
// complexity for what should be the rare case (see the three triggers
// below - a non-JSON.parse-compatible element, an all-comma/no-value
// grammar defect, or an oversized element) on the array shape this mode
// targets (one big, uniformly-shaped array of records). The common,
// intended case - a clean array with no such anomalies - never falls back
// at all and pays none of this cost.
//
// ## The three fallback triggers
//
//  1. A fully-delimited element's text is handed to `JSON.parse`, which
//     throws (see finishElement()) - in practice this is almost always the
//     `"""triple-quoted"""` extension, which `JSON.parse` can never accept
//     but the real engine does; genuinely malformed content also lands
//     here and is correctly re-reported as an error by the real engine.
//  2. A comma or the closing `]` arrives with no element bytes since the
//     last delimiter - a grammar defect (`[1,,2]`, `[1,]`, `[,1]`) the
//     scanner itself can detect without needing JSON.parse at all. The
//     wrap is reconstructed with the SAME defect shape (a synthetic empty
//     slot before the same delimiter - see the CLOSE_BRACKET/COMMA cases in
//     scanArrayBody()) so it still faithfully re-triggers a structural
//     error in the real engine instead of accidentally parsing as valid
//     (naively wrapping the empty span alone as `[]` would misparse a
//     trailing comma as a valid empty array - the synthetic `[,` prefix is
//     what avoids that).
//  3. An element is still open (no delimiter yet) once its accumulated size
//     exceeds `fastPathMaxRecordBytes` - mirrors NdjsonFastPath's own
//     size-cutoff spill, so no single element is ever fully materialized
//     in memory beyond that bound.
//
// See issue #86 for the full design write-up and the differential-test
// coverage this was validated against, and NdjsonFastPath.ts for the
// sibling NDJSON-shaped fast path (`fastPathMode: 'ndjson'`, the default)
// this one composes with via yajs.ts's `fastPathMode` option - see that
// option's doc comment in yajs.ts for how the two are told apart.
'use strict';

import { ChainEvaluator, compileFastPathEvaluator, EmitFn, FastPathOptions, GenericWalker } from './FastPathEvaluator';
import { FallbackEngine } from './NdjsonFastPath';
import { YAJSPath } from '../path/YAJSPath';

const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_BRACKET_BUF = Buffer.from('[', 'utf8');
const OPEN_BRACKET_COMMA_BUF = Buffer.from('[,', 'utf8');

function isWs(b: number): boolean {
    return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
}

export interface ArrayFastPathOptions extends FastPathOptions {
    /**
     * Same role as {@link NdjsonFastPathOptions.fastPathMaxRecordBytes}
     * (see yajs.ts's YAJSOptions.fastPathMaxRecordBytes doc comment), just
     * measured per array ELEMENT here rather than per NDJSON record.
     * Defaults to 8 MiB.
     */
    fastPathMaxRecordBytes?: number;
}

const DEFAULT_MAX_ELEMENT_BYTES = 8 * 1024 * 1024;

export class ArrayFastPath {

    private readonly kind: 'chain' | 'generic';
    private readonly chainEvaluator: ChainEvaluator;
    private readonly genericWalker: GenericWalker;
    private readonly maxElementBytes: number;

    // `array`: actively scanning for element boundaries (see scanArrayBody).
    // `prelude`: haven't yet seen the first non-whitespace byte, so the
    // top-level shape (array or not) is still unknown.
    // `done`: this array's true closing `]` has been found (or the input
    // was never array-shaped to begin with) - every further byte, for the
    // rest of the stream, is relayed to the real engine unwrapped/
    // un-rebased, permanently; no more scanning of any kind happens.
    private mode: 'prelude' | 'array' | 'done' = 'prelude';

    // Structural scan state - shared across write() calls, exactly like
    // JsonSaxParser's own per-instance state has to be (a chunk boundary
    // can land anywhere, including mid multi-byte-escape or mid nested
    // structure).
    private depth = 0;
    private inStr = false;
    private esc = false;
    // Bytes of the current in-progress (not yet delimiter-terminated)
    // element, accumulated across possibly several write() calls - mirrors
    // NdjsonFastPath's lineChunks/lineLen. Only meaningful while `!wrapped`
    // (once wrapped, bytes are relayed as they arrive - see the class doc
    // comment - so nothing needs buffering here).
    private pendingChunks: Buffer[] = [];
    private pendingLen = 0;
    // Whether an element is currently open, continuing at offset 0 of the
    // NEXT write() call's chunk (mirrors the arraysplit.js prototype's own
    // elemStart persistence convention).
    private elemOpen = false;
    // Has at least one depth-1 delimiter (a real comma, or a synthetic one
    // reconstructed by a fallback trigger below) fired for this array yet -
    // the discriminator between a legitimate `[]` (never) and `[,]`/`[1,]`
    // grammar defects (yes) at the closing bracket - see trigger #2 above.
    private anyDelimiterSeen = false;

    // Number of elements this instance has evaluated via the fast path so
    // far (0-based index of the NEXT element). Frozen at whatever value it
    // holds once a fallback triggers (fast evaluation never resumes for
    // this array - see the class doc comment) - that frozen value is
    // exactly the rebase offset every one of the fallback engine's emitted
    // root-array indices needs added back in.
    private elementIndex = 0;

    // True from the moment a fallback trigger has fed the real engine a
    // synthetic `[` until this array's true closing `]` is found (depth
    // returns to 0) - see the class doc comment's two-phase description.
    // While true: every scanned byte is also relayed to the fallback
    // engine (see scanArrayBody's trailing `if (this.wrapped)` step), and
    // every one of its emitted paths gets rebased.
    private wrapped = false;
    private rebaseOffset = 0;
    private fallback: FallbackEngine | null = null;
    // Whether anything but whitespace has been seen yet in the "done" mode
    // trailing content that follows this array's true closing `]` (see
    // relayTrailing() - mirrors the top-of-stream prelude skip in write()
    // itself, for the same reason: whitespace-only trailing content must
    // never be relayed on its own, or a freshly constructed fallback engine
    // that never sees any REAL value would misreport "no data", even
    // though this array itself - fast-pathed, never shown to any real
    // engine - was very much real data).
    private sawTrailingValue = false;

    constructor(yajsPath: YAJSPath, options: ArrayFastPathOptions, private readonly emit: EmitFn,
                private readonly reportError: (err: Error) => void,
                private readonly createFallbackEngine: (emit: EmitFn) => FallbackEngine) {
        const compiled = compileFastPathEvaluator(yajsPath, options, emit);
        this.kind = compiled.kind;
        if (compiled.kind === 'chain') {
            this.chainEvaluator = compiled.evaluator;
        } else {
            this.genericWalker = compiled.evaluator;
        }
        this.maxElementBytes = options.fastPathMaxRecordBytes > 0 ?
            options.fastPathMaxRecordBytes : DEFAULT_MAX_ELEMENT_BYTES;
    }

    write(chunk: Buffer): void {
        let i = 0;
        const len = chunk.length;

        if (this.mode === 'done') {
            this.relayTrailing(chunk);
            return;
        }

        if (this.mode === 'prelude') {
            while (i < len && isWs(chunk[i])) { i++; }
            if (i === len) { return; }
            if (chunk[i] !== OPEN_BRACKET) {
                // Not array-shaped at all - relay from here (inclusive) for
                // the rest of the stream, byte-identical to `fastPath:
                // false`. Nothing before `i` needs replaying: it was pure
                // JSON whitespace, insignificant to any parser (matches how
                // NdjsonFastPath's own isBlank() skip needs no replay
                // either).
                this.mode = 'done';
                this.relay(chunk.subarray(i));
                return;
            }
            this.mode = 'array';
            this.depth = 1;
            if (this.kind === 'generic') { this.genericWalker.walkRootArrayOpen(); }
            i++;
        }

        this.scanArrayBody(chunk, i);
    }

    end(): void {
        if (this.mode === 'prelude') {
            // Nothing but whitespace (or nothing at all) was ever seen -
            // replicate the default engine's "no data" error exactly like
            // NdjsonFastPath does for the same case.
            this.ensureFallback().finish();
            return;
        }
        if (this.mode === 'array') {
            // Stream ended without ever finding this array's true closing
            // `]` - genuinely unterminated input. Wrap whatever's pending
            // (if we hadn't already) and let the real engine's own
            // end-of-stream check report the appropriate error; the exact
            // reconstructed prefix doesn't need to be byte-perfect here
            // since the error being raised either way is about the
            // premature end of input, not this prefix's own content.
            if (!this.wrapped) {
                const prefix = this.pendingLen > 0 ?
                    Buffer.concat([OPEN_BRACKET_BUF, Buffer.concat(this.pendingChunks, this.pendingLen)]) :
                    OPEN_BRACKET_BUF;
                this.enterWrapped(prefix);
            }
            this.ensureFallback().finish();
            return;
        }
        // mode === 'done': finish the fallback engine only if one was ever
        // actually needed (a perfectly clean array with no trailing
        // content never constructs one at all).
        if (this.fallback) { this.fallback.finish(); }
    }

    // The core scan: finds depth-1 element boundaries of the current array,
    // evaluating each complete one via the fast evaluator, until either the
    // chunk is exhausted or a fallback trigger hands the rest of the array
    // off permanently (see the class doc comment). `startIdx` is always
    // strictly past the array's opening `[`.
    private scanArrayBody(chunk: Buffer, startIdx: number): void {
        const len = chunk.length;
        let elemStart = this.elemOpen ? 0 : -1;

        for (let i = startIdx; i < len; i++) {
            const b = chunk[i];
            let closedArrayThisByte = false;

            if (this.inStr) {
                if (this.esc) { this.esc = false; }
                else if (b === BACKSLASH) { this.esc = true; }
                else if (b === QUOTE) { this.inStr = false; }
            } else {
                switch (b) {
                    case QUOTE:
                        this.inStr = true;
                        if (!this.wrapped && this.depth === 1 && elemStart < 0) { elemStart = i; }
                        break;
                    case OPEN_BRACE:
                    case OPEN_BRACKET:
                        if (!this.wrapped && this.depth === 1 && elemStart < 0) { elemStart = i; }
                        this.depth++;
                        break;
                    case CLOSE_BRACE:
                        this.depth--;
                        break;
                    case CLOSE_BRACKET:
                        this.depth--;
                        if (this.depth === 0) {
                            closedArrayThisByte = true;
                            if (!this.wrapped) {
                                if (elemStart >= 0) {
                                    this.finishElement(chunk, elemStart, i);
                                    elemStart = -1;
                                } else if (this.anyDelimiterSeen) {
                                    // Trigger #2: trailing comma before
                                    // close (e.g. `[1,]`) - not a
                                    // legitimate empty `[]`.
                                    this.enterWrapped(OPEN_BRACKET_COMMA_BUF);
                                }
                                // else: a genuinely empty `[]` - nothing to
                                // finish, nothing malformed.
                            }
                        }
                        break;
                    case COMMA:
                        if (!this.wrapped && this.depth === 1) {
                            if (elemStart >= 0) {
                                this.finishElement(chunk, elemStart, i);
                            } else {
                                // Trigger #2: `[1,,2]` (double comma) or
                                // `[,1]` (leading comma) - see the class
                                // doc comment for why the reconstruction
                                // must preserve the empty-slot shape.
                                this.enterWrapped(
                                    this.anyDelimiterSeen ? OPEN_BRACKET_COMMA_BUF : OPEN_BRACKET_BUF);
                            }
                            elemStart = -1;
                            this.anyDelimiterSeen = true;
                        }
                        break;
                    default:
                        if (!this.wrapped && this.depth === 1 && elemStart < 0 && !isWs(b)) {
                            elemStart = i;
                        }
                }
            }

            // Trigger #3: an element still open (no delimiter reached yet)
            // has grown past the size cutoff - spill what's accumulated so
            // far instead of ever fully materializing it. Excludes byte
            // `i` itself from the prefix; the generic `if (this.wrapped)`
            // relay step just below covers it uniformly, exactly like it
            // covers the delimiter byte for the other two triggers.
            if (!this.wrapped && !closedArrayThisByte && elemStart >= 0) {
                const openLen = this.pendingLen + (i - elemStart);
                if (openLen > this.maxElementBytes) {
                    const soFar = this.pendingLen > 0 ?
                        Buffer.concat([...this.pendingChunks, chunk.subarray(elemStart, i)],
                            this.pendingLen + (i - elemStart)) :
                        chunk.subarray(elemStart, i);
                    this.pendingChunks = [];
                    this.pendingLen = 0;
                    this.enterWrapped(Buffer.concat([OPEN_BRACKET_BUF, soFar]));
                }
            }

            if (this.wrapped) {
                this.relay(chunk.subarray(i, i + 1));
            }

            if (closedArrayThisByte) {
                this.wrapped = false;
                this.mode = 'done';
                if (this.kind === 'generic') { this.genericWalker.walkRootArrayClose(); }
                if (i + 1 < len) { this.relayTrailing(chunk.subarray(i + 1)); }
                return;
            }
        }

        // Chunk exhausted mid-element. Only relevant while `!wrapped` -
        // once wrapped, every byte has already been relayed as it was
        // scanned, so there is nothing left to buffer here.
        if (!this.wrapped) {
            if (elemStart >= 0) {
                this.pendingChunks.push(Buffer.from(chunk.subarray(elemStart, len)));
                this.pendingLen += len - elemStart;
                this.elemOpen = true;
            } else {
                this.elemOpen = false;
            }
        }
    }

    // A complete depth-1 element span [start, end) of `chunk` was found
    // (delimited by a comma or the array's closing `]`, both already
    // consumed by the caller - `end` points at the delimiter, not past it).
    // Materializes the raw bytes (concatenating with anything buffered from
    // earlier write() calls - BEFORE decoding, exactly like NdjsonFastPath's
    // takeLine(): a chunk seam can fall inside a multi-byte UTF-8 sequence)
    // and evaluates it, or triggers fallback (#1 above) if `JSON.parse`
    // rejects it.
    private finishElement(chunk: Buffer, start: number, end: number): void {
        let raw: Buffer;
        if (this.pendingLen > 0) {
            raw = Buffer.concat([...this.pendingChunks, chunk.subarray(start, end)], this.pendingLen + (end - start));
            this.pendingChunks = [];
            this.pendingLen = 0;
        } else {
            raw = chunk.subarray(start, end);
        }
        let value: unknown;
        try {
            value = JSON.parse(raw.toString('utf8'));
        } catch {
            this.enterWrapped(Buffer.concat([OPEN_BRACKET_BUF, raw]));
            return;
        }
        this.evaluateElement(value);
    }

    private evaluateElement(value: unknown): void {
        try {
            if (this.kind === 'chain') {
                this.chainEvaluator.walkElement(value, this.elementIndex);
            } else {
                this.genericWalker.element(value);
            }
        } catch (e) {
            this.reportError(e instanceof Error ? e : new Error(String(e)));
        }
        this.elementIndex++;
    }

    // Enters permanent fallback for the rest of THIS array (see the class
    // doc comment): freezes elementIndex's current value as the rebase
    // offset every one of the fallback engine's emitted root-array indices
    // will need added back in, then relays `prefix` (the synthetic `[`
    // wrap plus whatever real content precedes/represents the trigger -
    // see the three call sites above) as the first bytes of that relay.
    private enterWrapped(prefix: Buffer): void {
        this.rebaseOffset = this.elementIndex;
        this.wrapped = true;
        this.relay(prefix);
    }

    private relay(buf: Buffer): void {
        if (buf.length === 0) { return; }
        this.ensureFallback().write(buf);
    }

    // Like relay(), but for content that follows this array's true closing
    // `]` (mode === 'done'): skips leading whitespace WITHOUT relaying it -
    // exactly like write()'s own top-of-stream prelude skip - until a real
    // byte is found, so a stream that ends with only trailing whitespace
    // (or nothing) after the array never constructs a fallback engine at
    // all, and end() never asks a virgin one to report "no data" for
    // content that, from the whole stream's perspective, very much wasn't
    // empty (see sawTrailingValue's field comment).
    private relayTrailing(buf: Buffer): void {
        if (this.sawTrailingValue) {
            this.relay(buf);
            return;
        }
        let i = 0;
        while (i < buf.length && isWs(buf[i])) { i++; }
        if (i === buf.length) { return; }
        this.sawTrailingValue = true;
        this.relay(buf.subarray(i));
    }

    private ensureFallback(): FallbackEngine {
        if (!this.fallback) {
            this.fallback = this.createFallbackEngine((path, value) => {
                if (this.wrapped && typeof path[0] === 'number') {
                    const rebased = path.slice();
                    rebased[0] = (rebased[0] as number) + this.rebaseOffset;
                    this.emit(rebased, value);
                } else {
                    this.emit(path, value);
                }
            });
        }
        return this.fallback;
    }
}
