import { Transform, Writable } from 'stream';
import Emitter = require('stream-json/Emitter');
import Packer = require('stream-json/Packer');
import Parser = require('stream-json/Parser');
import Streamer = require('stream-json/Streamer');
import { StreamContext } from './lib/context/StreamContext';
import { YAJSPath } from './lib/path/YAJSPath';

export default function yajs(path: string): Transform {
    return new YAJSStream(path);
}

class YAJSStream extends Transform {

    private parser: Writable;

    constructor(p: string) {
        super({
            readableObjectMode: true,
            writableObjectMode: false,
        });

        const yajsPath = YAJSPath.parse(p);
        const context = new StreamContext(yajsPath,
            (path, value) => {
                this.push({ path, value });
            });

        this.parser = new Parser({ jsonStreaming: true });

        this.parser.pipe(new Streamer()).
            pipe(new Packer({
                packKeys: true,
                packNumbers: true,
                packStrings: true })).
            pipe(new Emitter()).
            on('startObject', () => context.startObject()).
            on('endObject', () => context.endObject()).
            on('startArray', () => context.startArray()).
            on('endArray', () => context.endArray()).
            on('keyValue', (key: string) => context.startObjectEntry(key)).
            on('stringValue', (str: string) => context.onValue(str)).
            on('numberValue', (num: string) => context.onValue(+num)).
            on('nullValue', () => context.onValue(null)).
            on('falseValue', () => context.onValue(false)).
            on('trueValue', () => context.onValue(true));
    }

    _transform(chunk: any, encoding: string, callback: (err?: Error) => void): void {
        try {
            this.parser.write(chunk);
        } catch (e) {
            callback(e);
            return;
        }
        callback();
    }
}