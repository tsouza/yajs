import through from 'through';
import { ThroughStream } from 'through';
import { StreamContext } from './lib/context/StreamContext';
import { ArrayFastPath } from './lib/fastpath/ArrayFastPath';
import { HybridFastPath } from './lib/fastpath/HybridFastPath';
import { NdjsonFastPath } from './lib/fastpath/NdjsonFastPath';
import { YAJSPath } from './lib/path/YAJSPath';
import { JsonSaxParser } from './lib/utils/JsonSaxParser';

type EmitFn = (path: Array<string | number>, value: any) => void;

/**
 * The shape of each `'data'` event emitted by a yajs stream: the location of
 * the match plus its fully-materialized value.
 */
export interface YAJSChunk {
    /**
     * The sequence of object keys (and, when `pathIncludeArrayIndex` is
     * enabled, array indices) leading from the document root to the match.
     */
    path: Array<string | number>;
    /** The matched value. */
    value: any;
}

/** Options accepted by {@link yajs}. */
export interface YAJSOptions {
    /**
     * When true, array indices are included as numbers in each emitted
     * chunk's `path`. Defaults to false (indices are omitted).
     */
    pathIncludeArrayIndex?: boolean;

    /**
     * Opt-in NDJSON fast path (see issue #78 for the full design/measured
     * numbers): instead of tokenizing every byte through the SAX engine,
     * splits input on `\n` and hands each line to native `JSON.parse` plus
     * a compiled-selector walker, falling back to the normal streaming
     * engine - byte-for-byte identical to the non-fastPath behavior - for
     * anything a single `JSON.parse` call can't handle on its own (a
     * record over `fastPathMaxRecordBytes`, malformed input, a
     * pretty-printed record spanning multiple lines, the `"""` extension,
     * or multiple values on one line). Measured ~5x end-to-end throughput
     * for the common "definite key chain" selector shape (e.g.
     * `$.field2.nested`) against NDJSON input.
     *
     * Defaults to `false`: this is a newer, less battle-tested code path
     * than the default engine, and - unlike `pathIncludeArrayIndex` - it is
     * NOT purely an output-shape option; it changes how the input is
     * parsed and has two accepted, documented semantic divergences from
     * the default engine (both inherent to using `JSON.parse` under the
     * hood, not implementation bugs):
     *
     *   1. **Duplicate object keys**: the default engine emits one match
     *      per occurrence of a duplicated key; `JSON.parse` (and so
     *      `fastPath`) keeps only the last occurrence.
     *   2. **Integer-like key emission order**: when an object's raw text
     *      key order differs from JavaScript's own-property enumeration
     *      order for integer-like keys (which `JSON.parse` - and so
     *      `Object.keys()` - always reindexes ahead of string keys,
     *      regardless of source order), the *order* matches are emitted in
     *      for that object's siblings can differ. Values and paths are
     *      unaffected either way.
     *
     * There is deliberately no "auto" mode that detects NDJSON shape on
     * the fly - enable this only for input you know is NDJSON-shaped
     * (whitespace/newline-separated top-level JSON values); on any other
     * shaped input it still produces correct output (everything falls back
     * to the real engine record-by-record), just without the speedup.
     *
     * One additional, purely cosmetic difference: an `error` event's
     * message includes a byte "position", which is always relative to
     * whichever buffer the underlying parser happened to be given (true of
     * the default engine too - it differs for the same failure depending
     * on how a caller chunks its own `.write()` calls) - under `fastPath`,
     * a malformed record's position is relative to that one record's own
     * line, since the record is handed to the fallback engine in
     * isolation. The error is still reported for the correct record, with
     * the same message shape and the same per-record resync guarantee
     * (issue #50) - only that one number can differ from a non-fastPath,
     * single-`.write()`-call run of the same input.
     *
     * `true` (or `'line'`) selects the fast path described above. Set it
     * to `'hybrid'` instead to select the newer SKIP/PARSE/DESCEND
     * span-parsing hybrid (issues #79/#87): rather than materializing a
     * whole record via `JSON.parse` and walking the result, it navigates
     * the record's raw bytes directly to the matched value(s) and
     * `JSON.parse`s only their exact byte span. It is a strict SUBSET of
     * `'line'` mode's selector coverage - only `$..k1.k2...kn`-shaped
     * descendant selectors (one `..`, no wildcards/ancestor-filters, no
     * definite prefix before the `..`, no `pathIncludeArrayIndex`) get the
     * hybrid's own scanning; every other selector shape - including a
     * plain definite chain like `$.field2.nested`, which `'line'` mode
     * already handles well via a single `JSON.parse` - transparently
     * behaves exactly like `'line'` mode instead (see
     * HybridFastPath.ts/HybridSpanEvaluator.ts for the full reasoning).
     * For the descendant-shaped selectors it does compile, it measures
     * substantially better throughput than `'line'` mode on high-
     * selectivity matches (see README's Performance section for fresh,
     * per-shape numbers) and - unlike `'line'` mode - never needs to fall
     * back to the real engine just because ONE record is huge (see
     * `hybridMaxSpanBytes` below): it only ever buffers matched spans, not
     * whole records, so an otherwise-enormous document with modest
     * individual matches still gets the speedup. Same opt-in philosophy
     * as `'line'` mode: no auto-detection of which mode best suits a given
     * selector/input shape, and both are newer, less battle-tested code
     * paths than the default engine.
     */
    fastPath?: boolean | 'line' | 'hybrid';

    /**
     * Selects which input SHAPE `fastPath` assumes it is looking at. Only
     * meaningful when `fastPath` is true. Two shapes are supported, and -
     * same "no auto-detection" philosophy as `fastPath` itself - picking
     * between them is always an explicit, opt-in choice, never sniffed
     * from the input:
     *
     *   - `'ndjson'` (the default): the input is many whitespace-separated
     *     top-level JSON values - see `fastPath`'s own doc comment above.
     *   - `'array'`: the input is (a prefix of whitespace, then) exactly
     *     one big top-level JSON array, whose elements are the unit
     *     `fastPath` splits on - the "array splitter" fast path (issue
     *     #86), treating a top-level array as comma-delimited "NDJSON".
     *     Once that array's closing `]` is found, anything further in the
     *     stream is handled by the normal streaming engine (see
     *     ArrayFastPath.ts's class doc comment for the full design and,
     *     in particular, why - unlike `'ndjson'` - a single element this
     *     mode can't fast-path falls back for the *rest* of the array
     *     rather than resuming afterward).
     *
     * Input that doesn't match the selected shape is never silently
     * misinterpreted: `'array'` on input that isn't a top-level array (a
     * plain single document, or NDJSON-shaped lines) simply never finds
     * a fast-pathable element and produces correct output via the normal
     * streaming engine end to end, exactly as if `fastPath` were false -
     * just without the speedup. Likewise `'ndjson'` on a top-level-array
     * input already works correctly today (see the `$` "root array" case
     * in 10-fastpath.ts) via its own per-line JSON.parse + element
     * streaming - `'array'` exists to make that specific common shape
     * fast too, by skipping the line-oriented framing NDJSON mode assumes
     * an array doesn't need.
     */
    fastPathMode?: 'ndjson' | 'array';

    /**
     * Per-record size cutoff, in bytes of a record's raw (not yet parsed)
     * text, above which `fastPath: 'line'` (or `true`) routes that one
     * record to the normal streaming engine instead of ever materializing
     * it as a JS string/`JSON.parse` tree - guards against unbounded
     * memory growth on an unexpectedly (or adversarially) huge single
     * record. Under `fastPathMode: 'array'`, the same cutoff applies per
     * array ELEMENT instead of per NDJSON record. Only meaningful for
     * `'line'` mode (including `fastPathMode: 'array'`) - for `'hybrid'`
     * mode's own, differently-scoped cutoff, see `hybridMaxSpanBytes`.
     * Defaults to 8 MiB.
     */
    fastPathMaxRecordBytes?: number;

    /**
     * `fastPath: 'hybrid'`'s own size cutoff - unlike
     * `fastPathMaxRecordBytes`, this bounds one MATCHED VALUE's own raw
     * byte span, not the whole record it's found in (see `fastPath`'s doc
     * comment for why that distinction is the point of hybrid mode). A
     * record whose matches all stay under this cutoff gets the full
     * hybrid speedup no matter how large the record itself is; a record
     * with even one match over this cutoff falls back to the real
     * streaming engine for the rest of the stream (see
     * HybridFastPath.ts). Defaults to 8 MiB.
     */
    hybridMaxSpanBytes?: number;
}

// The declared return type is NodeJS.ReadWriteStream rather than
// stream.Transform: the object actually returned is a classic `through`
// stream (`instanceof stream.Transform` is false), so claiming Transform
// would invite consumers to rely on Transform-specific API that isn't
// there. NodeJS.ReadWriteStream is the conventional interface for
// through-style streams and covers everything yajs supports and documents:
// write()/end(), pipe(), pause()/resume(), and the EventEmitter surface
// ('data'/'error'/'end' - see YAJSChunk for the 'data' payload).
export default function yajs(path: string, options: YAJSOptions = {
    pathIncludeArrayIndex: false,
}): NodeJS.ReadWriteStream {
    const yajsPath = YAJSPath.parse(path);

    // The emit function every match (fast-path or default engine) is routed
    // through: through's own queue()/push() (they're the same function -
    // see node_modules/through/index.js) instead of stream.emit('data', ...)
    // directly. queue() appends to through's internal buffer and only emits
    // 'data' while `!stream.paused` (drain()), which is the only path that
    // respects the pause Node's .pipe() applies on backpressure from a slow
    // downstream consumer - emit('data', ...) bypasses that entirely and
    // forces synchronous delivery regardless of consumer readiness (issue
    // #36).
    const emit: EmitFn = (p, value) => stream.queue({ path: p, value });
    const reportError = (err: Error) => stream.emit('error', err);

    let stream: ThroughStream;
    if (options.fastPath && options.fastPathMode === 'array') {
        // Opt-in array-splitter fast path (see YAJSOptions.fastPathMode's
        // doc comment and issue #86) - same idea as the NDJSON branch just
        // below, generalized to a top-level array's comma-delimited
        // elements instead of newline-delimited lines. No `onBoundary` hook
        // is needed here (unlike the NDJSON branch): ArrayFastPath's own
        // structural scanner independently tracks bracket depth through a
        // fallback relay, so it always knows exactly where to stop
        // rebasing/wrapping without the real engine's help - see
        // ArrayFastPath.ts's class doc comment.
        const fastPath = new ArrayFastPath(yajsPath, options, emit, reportError,
            (arrayEmit) => {
                const parser = createEngine(yajsPath, options, arrayEmit, reportError);
                return {
                    write: (buf: Buffer) => parser.parse(buf),
                    finish: () => { parser.finish(); parser.flushPendingString(); },
                };
            });
        stream = through(
            (chunk: Buffer | string) => fastPath.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
            () => {
                fastPath.end();
                stream.queue(null);
            });
        return stream;
    }
    if (options.fastPath) {
        // Opt-in fast path (see YAJSOptions.fastPath's doc comment) -
        // bypasses the SAX tokenizer entirely for input JSON.parse can
        // handle, falling back to a normal engine instance (createEngine -
        // the exact same one the default, non-fastPath branch below uses)
        // for anything it can't. `'hybrid'` selects the SKIP/PARSE/DESCEND
        // span-parsing evaluator (issues #79/#87) for selectors it
        // supports (falling back to the same 'line' machinery below for
        // any it doesn't - see HybridFastPath.ts); anything else
        // (`true`/`'line'`) selects the original line/chain fast path
        // (issue #78).
        const fallbackFactory = (onBoundary: () => void) => {
            const parser = createEngine(yajsPath, options, emit, reportError, onBoundary);
            return {
                write: (buf: Buffer) => parser.parse(buf),
                finish: () => { parser.finish(); parser.flushPendingString(); },
            };
        };
        const fastPath = options.fastPath === 'hybrid' ?
            new HybridFastPath(yajsPath, options, emit, reportError, fallbackFactory) :
            new NdjsonFastPath(yajsPath, options, emit, reportError, fallbackFactory);
        stream = through(
            (chunk: Buffer | string) => fastPath.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
            () => {
                fastPath.end();
                // See the matching stream.queue(null) comment in the
                // default (non-fastPath) branch below - same reasoning.
                stream.queue(null);
            });
        return stream;
    }

    stream = through(
        // `through`'s own write() (node_modules/through/index.js) does no
        // string-to-Buffer coercion - it hands whatever was passed to
        // .write()/.pipe() straight through to this callback. JsonSaxParser
        // deliberately does raw numeric byte indexing (buffer[i] compared
        // against byte constants - see JsonSaxParser.ts), which only makes
        // sense for a Buffer: indexing into a plain string yields
        // single-character strings, every numeric comparison silently fails,
        // and parsing falls through into a confusing, content-independent
        // NUL-byte error (issue #61). A plain JS string is nonetheless a very
        // natural thing to .write() to a "JSON streaming" library, and
        // nothing in the README/types warns otherwise - so convert it here
        // instead, at the one point both .write(str) and .pipe() from a
        // string-mode Readable funnel through (pipe() just calls
        // dest.write(chunk) per 'data' event - same code path). This keeps
        // JsonSaxParser itself Buffer-only and simple. Buffer.from()'s
        // default encoding is UTF-8, which matches this library's stated
        // JSON/UTF-8 handling elsewhere (see JsonSaxParser's appendUtf8Byte)
        // and correctly round-trips non-ASCII content. Buffer chunks pass
        // through unchanged - existing Buffer-based usage is unaffected.
        (chunk: Buffer | string) => parser.parse(typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
        () => {
            parser.finish();
            // A bare string value (e.g. a lone root string, or the last item before
            // stream end) has no trailing `,`/`]`/`}` to trigger the flush below -
            // flush whatever is still pending now that input has ended.
            parser.flushPendingString();
            // Signal end via through's own queue rather than stream.emit('end')
            // directly: through's internal drain() only emits 'end' once every
            // already-queued match has been drained out past `stream.paused` (see
            // the stream.queue() call below for why that matters) - emitting 'end'
            // directly here would jump the queue and fire it before a still-paused
            // consumer has received matches queued earlier in this same tick.
            stream.queue(null);
        });

    const parser = createEngine(yajsPath, options, emit, reportError);

    return stream;
}

// Builds one full StreamContext+JsonSaxParser pair, wired together exactly
// as the original single-engine yajs() pipeline always did. Factored out so
// both the default (non-fastPath) branch above and the fastPath branch's
// on-demand fallback-engine factory (see NdjsonFastPath.ts) build identical,
// independent engine instances - each with its own local `errored` state
// (see createSaxParser below), sharing only `emit`/`reportError` (which
// route to the one `stream` both branches ultimately return).
// `onBoundary`, when given, is threaded into createSaxParser - see its own
// comment for why the fast path needs it.
function createEngine(yajsPath: YAJSPath, options: YAJSOptions, emit: EmitFn,
                       reportError: (err: Error) => void, onBoundary?: () => void): any {
    // Shared between JsonSaxParser's onError and StreamContext's onError -
    // see the comment on flushPendingString() in createSaxParser for why
    // every source of 'error' for THIS engine instance needs to mark the
    // same flag. Local to this instance (not shared across fastPath's
    // separate fallback-engine instances) - each is an independent NDJSON
    // sub-stream as far as error/resync bookkeeping is concerned.
    const state = { errored: false };
    const context = new StreamContext(yajsPath, emit, options.pathIncludeArrayIndex,
        (err) => { state.errored = true; reportError(err); });
    return createSaxParser(context, state, reportError, onBoundary);
}

// `onBoundary`, when given, fires alongside onResync/onValueBoundary below -
// see NdjsonFastPath.ts for why the fast path needs to know exactly when
// the underlying engine is back at a clean top-level-record boundary.
function createSaxParser(context: StreamContext, state: { errored: boolean },
                          onError: (err: Error) => void, onBoundary?: () => void): any {
    let strValue;

    // Once any source of error on this stream (JsonSaxParser's own grammar,
    // or - defense in depth - StreamContext's structural guards) has fired,
    // nothing still buffered can be trusted as a legitimately-resolved
    // value - in particular a string still sitting in `strValue` was never
    // confirmed as the document's actual value (that confirmation is
    // exactly what the disambiguating token - `,`/`:`/`]`/`}`/end-of-stream
    // - that never arrived was for). Without this guard, flushPendingString()
    // would emit it anyway once end-of-stream calls it unconditionally,
    // making the stream report both an 'error' and a spurious 'data' + clean
    // 'end' for the same invalid document.
    //
    // `state.errored` is cleared again on `onResync` below, once JsonSaxParser
    // recovers from that error at an NDJSON newline boundary: it exists to
    // invalidate the specific record that failed, not every record for the
    // rest of the stream, and a fresh record's own strValue deserves the
    // exact same disambiguation-before-flush treatment as the first one.
    const flushPendingString = () => {
        if (!state.errored && strValue != null) {
            context.onValue(strValue);
            strValue = null;
        }
    };

    const parser: any = new JsonSaxParser({
        onBoolean: (bool) => {
            strValue = null;
            context.onValue(bool);
        },
        onColon: () => {
            context.startObjectEntry(strValue);
            strValue = null;
        },
        onComma: () => flushPendingString(),
        onEndArray: () => {
            flushPendingString();
            context.endArray();
        },
        onEndObject: () => {
            flushPendingString();
            context.endObject();
        },
        onError: (err) => {
            state.errored = true;
            onError(err);
        },
        onNull: () => {
            strValue = null;
            context.onValue(null);
        },
        // Fired once JsonSaxParser has abandoned a failed NDJSON record and
        // resynced at the next newline (see JsonSaxParser's own
        // resyncAfterError()) - i.e. after the onError above already
        // reported that record's failure, and before any callback for the
        // next record fires. `strValue` is discarded rather than flushed:
        // whatever string was pending belonged to the abandoned record and,
        // same as any other of its data, was never confirmed as a real
        // value. `state.errored` resets so the *next* record's own pending
        // string gets to go through flushPendingString()'s normal
        // disambiguation instead of being silently discarded forever.
        // context.resyncAfterError() mirrors this at the structural-position
        // layer - see its own comment in StreamContext.ts for why `reset()`
        // alone isn't enough here.
        onResync: () => {
            strValue = null;
            state.errored = false;
            context.resyncAfterError();
            // A resync is itself a clean top-level-record boundary (the
            // next byte starts a fresh document - see JsonSaxParser's own
            // resyncAfterError()) - see NdjsonFastPath.ts for why the fast
            // path needs to know this.
            onBoundary?.();
        },
        onNumber: (num) => {
            strValue = null;
            context.onValue(num);
        },
        onStartArray: () => {
            strValue = null;
            context.startArray();
        },
        onStartObject: () => {
            strValue = null;
            context.startObject();
        },
        onString: (str) => {
            // Flush a previously buffered string before overwriting it: two bare
            // string values at the document root (ndjson-style, whitespace-separated,
            // no `,` between them) would otherwise silently lose the first one.
            flushPendingString();
            strValue = str;
        },
        // See the extensive comment on onValueBoundary in JsonSaxParser.ts:
        // this is the whitespace-confirmed NDJSON record boundary - the one
        // disambiguation point besides onComma/onEndArray/onEndObject/onString
        // that a still-buffered strValue needs to be flushed at (issue #56).
        // Without this, a bare top-level string immediately followed - across
        // just a newline, no comma - by a differently-typed next record (a
        // number/bool/null/array/object, or one that itself goes on to error)
        // either silently discarded the buffered string (those callbacks all
        // reset strValue = null without flushing first) or, once the next
        // record's own error set state.errored, made it permanently
        // unflushable by flushPendingString()'s own guard - even though that
        // guard's job is to protect a string that belongs to the record
        // that's actually failing, not one already confirmed complete before
        // it. Firing the flush right here, before any byte of the next
        // record is even parsed, sidesteps both failure modes.
        onValueBoundary: () => {
            flushPendingString();
            onBoundary?.();
        },
    } as JsonSaxParser.ICallbacks);

    parser.flushPendingString = flushPendingString;
    return parser;
}
