import { Transform } from 'stream';
import through from 'through';
import { ThroughStream } from 'through';
import { StreamContext } from './lib/context/StreamContext';
import { YAJSPath } from './lib/path/YAJSPath';
import { JsonSaxParser } from './lib/utils/JsonSaxParser';

export default function yajs(path: string, options = {
    pathIncludeArrayIndex: false,
}): Transform {
    const stream = through(
        (chunk: Buffer) => parser.parse(chunk),
        () => {
            parser.finish();
            // A bare string value (e.g. a lone root string, or the last item before
            // stream end) has no trailing `,`/`]`/`}` to trigger the flush below -
            // flush whatever is still pending now that input has ended.
            parser.flushPendingString();
            stream.emit('end');
        });

    const yajsPath = YAJSPath.parse(path);
    const context = new StreamContext(yajsPath,
        (p, value) => stream.emit('data', { path: p, value }),
        options.pathIncludeArrayIndex);

    const parser = createSaxParser(context, stream);

    return stream;
}

function createSaxParser(context: StreamContext, stream: ThroughStream): any {
    let strValue;

    // A completed string token is buffered here rather than dispatched immediately,
    // because the parser can't tell us yet whether it's an object key (followed by
    // `:`, see onColon) or a value (followed by `,`/`]`/`}`, or is the stream's end).
    const flushPendingString = () => {
        if (strValue != null) {
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
        onError: (err) => stream.emit('error', err),
        onNull: () => {
            strValue = null;
            context.onValue(null);
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
