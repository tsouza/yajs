// NDJSON fast-path stream orchestrator: splits raw input on `\n` bytes,
// evaluates each record via the compiled fast-path evaluator
// (FastPathEvaluator.ts), and hands anything it can't safely fast-path off
// to a real JsonSaxParser+StreamContext engine (yajs.ts's own "default"
// engine, reused unmodified) - see the class doc comment below for the
// full handoff design, and issue #78 for the write-up this implements.
'use strict';

import { YAJSPath } from '../path/YAJSPath';
import { compileFastPathEvaluator, EmitFn, FastPathDocumentEvaluator, FastPathOptions } from './FastPathEvaluator';

const NEWLINE = Buffer.from('\n');
const WHITESPACE_BYTES = new Set([0x20, 0x09, 0x0d]); // space, tab, CR (LF is the delimiter itself)

/**
 * The real per-record engine the fast path falls back to. Constructed
 * lazily (only if a record ever actually needs it) via the
 * `createFallbackEngine` factory passed to {@link NdjsonFastPath}'s
 * constructor - see yajs.ts's `fastPath` branch (inside the exported
 * `yajs()` function) for what that factory builds.
 */
export interface FallbackEngine {
    /** Feeds raw bytes to the underlying JsonSaxParser. */
    write(buf: Buffer): void;
    /** Runs JsonSaxParser's own end-of-stream checks (see JsonSaxParser#finish). */
    finish(): void;
}

export interface NdjsonFastPathOptions extends FastPathOptions {
    /**
     * Per-record size cutoff, in bytes of the record's raw (not-yet-parsed)
     * text, above which a record is routed to the real streaming engine
     * instead of ever being materialized as a JS string/JSON.parse tree -
     * the size-cutoff-with-fallback design from issue #78's memory-tradeoff
     * analysis, guarding against unbounded memory growth on an
     * adversarially (or just unexpectedly) huge single record. Defaults to
     * 8 MiB.
     */
    fastPathMaxRecordBytes?: number;
}

const DEFAULT_MAX_RECORD_BYTES = 8 * 1024 * 1024;

/**
 * Line-buffering NDJSON fast path.
 *
 * For each `\n`-delimited record: if it is no larger than
 * `fastPathMaxRecordBytes` and `JSON.parse` accepts it on its own, it is
 * walked directly by the compiled fast-path evaluator (FastPathEvaluator.ts)
 * - no byte-by-byte tokenization at all. Otherwise (oversized, or
 * `JSON.parse` throws - which covers malformed lines, pretty-printed
 * records spanning multiple physical lines, the `"""` triple-quote
 * extension JSON.parse can never accept, and multiple values on one line)
 * the record is handed off to a real JsonSaxParser+StreamContext engine
 * instead of being reimplemented here.
 *
 * That handoff is deliberately NOT "fall back for the rest of the stream":
 * once a record needs the real engine, its own raw line (plus, if it turns
 * out to span further physical lines, each following line) is relayed to
 * the fallback engine one line at a time until the fallback engine's own
 * onBoundary hook confirms it is back at a clean top-level-record boundary
 * (either a value just completed - JsonSaxParser's onValueBoundary - or a
 * post-error resync at the next newline, preserving issue #50's exact
 * per-record error-and-resync semantics) - at which point fast-path line
 * scanning resumes for whatever comes after. Because the fallback engine
 * IS the same engine the non-fastPath path uses, this reuses its
 * multi-line/triple-quote/malformed-resync handling rather than
 * reimplementing (and risking subtly diverging from) it - the fallback
 * behavior is byte-identical to the non-fastPath engine's, by
 * construction, for every record it ends up handling.
 */
export class NdjsonFastPath {

    private readonly evaluator: FastPathDocumentEvaluator;
    private readonly maxRecordBytes: number;

    // Bytes of the current in-progress (not yet newline-terminated) record,
    // accumulated across possibly several write() calls. Always empty
    // while relayMode is true (see the class doc comment - a record that
    // enters relay mode is always fully handed to the fallback engine, one
    // physical line at a time, so there is nothing left for the fast path
    // itself to accumulate until relay mode ends).
    private lineChunks: Buffer[] = [];
    private lineLen = 0;
    // True once a record has been handed off to the fallback engine and it
    // has not yet confirmed (via onBoundary) that it is back at a clean
    // record boundary - i.e. every subsequent byte, up to the next `\n`,
    // belongs to that same fallback-handled record and must be relayed
    // (never fast-path-attempted) too.
    private relayMode = false;
    // Mirrors the fallback engine's own boundary state (see onBoundary
    // below); starts true since nothing has been fed to it yet.
    private atBoundary = true;
    private usedFallback = false;
    // Whether any non-blank top-level record has been seen at all (via
    // either path) - used only to replicate the default engine's own
    // "empty/whitespace-only document" error at true end-of-stream (see
    // end() below).
    private sawAnyValue = false;
    private fallback: FallbackEngine;

    constructor(yajsPath: YAJSPath, options: NdjsonFastPathOptions, emit: EmitFn,
                private readonly reportError: (err: Error) => void,
                private readonly createFallbackEngine: (onBoundary: () => void) => FallbackEngine) {
        this.evaluator = compileFastPathEvaluator(yajsPath, options, emit).evaluator;
        this.maxRecordBytes = options.fastPathMaxRecordBytes > 0 ?
            options.fastPathMaxRecordBytes : DEFAULT_MAX_RECORD_BYTES;
    }

    write(chunk: Buffer): void {
        let pos = 0;
        while (pos < chunk.length) {
            const nl = chunk.indexOf(0x0a, pos);
            if (this.relayMode) {
                const end = nl === -1 ? chunk.length : nl + 1;
                this.feedFallback(chunk.subarray(pos, end));
                pos = end;
                if (nl !== -1 && this.atBoundary) { this.relayMode = false; }
                continue;
            }
            if (nl === -1) {
                const remainder = chunk.subarray(pos);
                this.lineChunks.push(remainder);
                this.lineLen += remainder.length;
                pos = chunk.length;
                if (this.lineLen > this.maxRecordBytes) {
                    this.spillAccumulatedToFallback(false);
                }
                continue;
            }
            const piece = chunk.subarray(pos, nl);
            this.lineChunks.push(piece);
            this.lineLen += piece.length;
            pos = nl + 1;
            if (this.lineLen > this.maxRecordBytes) {
                this.spillAccumulatedToFallback(true);
                continue;
            }
            this.processLine(this.takeLine());
        }
    }

    end(): void {
        if (this.lineChunks.length > 0) {
            const line = this.takeLine();
            if (!isBlank(line)) {
                this.sawAnyValue = true;
                if (!this.tryFastPath(line)) {
                    // No trailing `\n` (this is genuinely the last bytes of
                    // the stream) - finish() below reports whatever this
                    // leaves dangling (or nothing, if it happens to be a
                    // complete document).
                    this.feedFallback(line);
                }
            }
        }
        if (this.usedFallback) {
            this.fallback.finish();
        } else if (!this.sawAnyValue) {
            // Nothing was ever seen at all (empty or whitespace-only
            // input) - replicate the default (non-fastPath) engine's "no
            // data" error by handing a virgin fallback engine straight to
            // finish(): it independently reaches the same conclusion.
            this.ensureFallback();
            this.fallback.finish();
        }
    }

    private takeLine(): Buffer {
        const line = this.lineChunks.length === 1 ?
            this.lineChunks[0] : Buffer.concat(this.lineChunks, this.lineLen);
        this.lineChunks = [];
        this.lineLen = 0;
        return line;
    }

    // The in-progress record has exceeded maxRecordBytes, either before
    // (withNewline false) or exactly as (withNewline true) a `\n` was
    // found. Flushes whatever has been accumulated to the fallback engine
    // - so it is never itself materialized as one big string/JSON.parse
    // tree - and enters relay mode unless the fallback engine is
    // immediately back at a boundary (e.g. a single huge but otherwise
    // ordinary, complete record).
    private spillAccumulatedToFallback(withNewline: boolean): void {
        this.feedFallback(this.takeLine());
        if (withNewline) { this.feedFallback(NEWLINE); }
        if (!this.atBoundary) { this.relayMode = true; }
    }

    private processLine(line: Buffer): void {
        if (isBlank(line)) { return; }
        this.sawAnyValue = true;
        if (this.tryFastPath(line)) { return; }
        this.feedFallback(line);
        this.feedFallback(NEWLINE);
        if (!this.atBoundary) { this.relayMode = true; }
    }

    // Returns true if `line` was handled (successfully or not) by the fast
    // path - i.e. JSON.parse accepted it. Returns false (leaving `line`
    // completely unconsumed - nothing has been fed to the fallback engine
    // yet) when JSON.parse itself throws, so the caller can route it there
    // instead.
    private tryFastPath(line: Buffer): boolean {
        let value: any;
        try {
            value = JSON.parse(line.toString('utf8'));
        } catch {
            return false;
        }
        try {
            this.evaluator.walkDocument(value);
        } catch (e) {
            this.reportError(e instanceof Error ? e : new Error(String(e)));
        }
        return true;
    }

    private feedFallback(buf: Buffer): void {
        if (buf.length === 0) { return; }
        this.ensureFallback();
        this.usedFallback = true;
        this.atBoundary = false;
        this.fallback.write(buf);
    }

    private ensureFallback(): void {
        if (!this.fallback) {
            this.fallback = this.createFallbackEngine(() => { this.atBoundary = true; });
        }
    }
}

function isBlank(buf: Buffer): boolean {
    for (let i = 0; i < buf.length; i++) {
        if (!WHITESPACE_BYTES.has(buf[i])) { return false; }
    }
    return true;
}
