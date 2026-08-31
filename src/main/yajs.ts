import through from 'through';
import { ThroughStream } from 'through';
import { StreamContext } from './lib/context/StreamContext';
import { YAJSPath } from './lib/path/YAJSPath';
import { JsonSaxParser } from './lib/utils/JsonSaxParser';

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
    // Shared between JsonSaxParser's onError and StreamContext's onError -
    // see the comment on flushPendingString() below for why every source of
    // 'error' on this stream needs to mark the same flag.
    const state = { errored: false };

    const stream = through(
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

    const yajsPath = YAJSPath.parse(path);
    const context = new StreamContext(yajsPath,
        // Route matches through through's own queue()/push() (they're the same
        // function - see node_modules/through/index.js) instead of
        // stream.emit('data', ...) directly. queue() appends to through's
        // internal buffer and only emits 'data' while `!stream.paused`
        // (drain()), which is the only path that respects the pause Node's
        // .pipe() applies on backpressure from a slow downstream consumer -
        // emit('data', ...) bypasses that entirely and forces synchronous
        // delivery regardless of consumer readiness (issue #36).
        (p, value) => stream.queue({ path: p, value }),
        options.pathIncludeArrayIndex,
        (err) => {
            state.errored = true;
            stream.emit('error', err);
        });

    const parser = createSaxParser(context, stream, state);

    return stream;
}

function createSaxParser(context: StreamContext, stream: ThroughStream,
                          state: { errored: boolean }): any {
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
            stream.emit('error', err);
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
        onValueBoundary: () => flushPendingString(),
    } as JsonSaxParser.ICallbacks);

    parser.flushPendingString = flushPendingString;
    return parser;
}
