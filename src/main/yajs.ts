import { Transform } from 'stream';
import through from 'through';
import { ThroughStream } from 'through';
import { StreamContext } from './lib/context/StreamContext';
import { YAJSPath } from './lib/path/YAJSPath';
import { JsonSaxParser } from './lib/utils/JsonSaxParser';

export default function yajs(path: string, options = {
    pathIncludeArrayIndex: false,
}): Transform {
    // Shared between JsonSaxParser's onError and StreamContext's onError -
    // see the comment on flushPendingString() below for why every source of
    // 'error' on this stream needs to mark the same flag.
    const state = { errored: false };

    const stream = through(
        (chunk: Buffer) => parser.parse(chunk),
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
    } as JsonSaxParser.ICallbacks);

    parser.flushPendingString = flushPendingString;
    return parser;
}
