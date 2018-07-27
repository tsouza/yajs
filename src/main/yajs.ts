import { Transform, Writable } from 'stream';
import * as through from 'through';
import { ThroughStream } from 'through';
import { StreamContext } from './lib/context/StreamContext';
import { YAJSPath } from './lib/path/YAJSPath';
import { JsonSaxParser } from './lib/utils/JsonSaxParser';

export default function yajs(path: string, options = {
    pathIncludeArrayIndex: false,
}): Transform {
    let context;
    let parser;
    const stream = through(
        (chunk: Buffer) => parser.parse(chunk),
        () => {
            parser.finish();
            stream.emit('end');
        });

    const yajsPath = YAJSPath.parse(path);
    context = new StreamContext(yajsPath,
        (p, value) => stream.emit('data', { path: p, value }),
        options.pathIncludeArrayIndex);

    parser = createSaxParser(context, stream);

    return stream;
}

function createSaxParser(context: StreamContext, stream: ThroughStream): any {
    let strValue;
    return new JsonSaxParser({
        onBoolean: (bool) => {
            strValue = null;
            context.onValue(bool);
        },
        onColon: () => {
            context.startObjectEntry(strValue);
            strValue = null;
        },
        onComma: () => {
            if (strValue != null) {
                context.onValue(strValue);
                strValue = null;
            }
        },
        onEndArray: () => {
            if (strValue) {
                context.onValue(strValue);
                strValue = null;
            }
            context.endArray();
        },
        onEndObject: () => {
            if (strValue) {
                context.onValue(strValue);
                strValue = null;
            }
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
        onString: (str) => strValue = str,
    } as JsonSaxParser.ICallbacks);
}
