import { createReadStream } from 'fs';
import { Meter } from 'measured';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick';
import { streamValues } from 'stream-json/streamers/stream-values';
import { createGunzip } from 'zlib';

const TYPE = process.env.TYPE || 'ndjson';
const meter = new Meter();
const stream = createReadStream(`./data/data-${process.env.DATA}.${TYPE}.gz`).
    pipe(createGunzip());

if (process.send) {
    setInterval(() => process.send({ rate: meter.toJSON() }), 1000);
} else {
    setInterval(() => console.log({ rate: meter.toJSON() }), 1000);
}

// Unlike yajs/JSONStream/oboe, which each have their own dot-path selector
// DSL, stream-json's pick() filter is a predicate over the `stack` of
// keys/array-indices a token is nested under (see
// stream-json/src/core/filters/filter-base.js) - a plain string or RegExp
// is matched against stack.join('.'). JSON_PATH here is therefore the
// *source of a RegExp* (stream-json's own native filter type, see its
// README), not a dot-path in the other libraries' sense. It is written to
// match on the tail of the path so it fires once per matched leaf/element
// regardless of how deep that element is nested (mirroring the recursive
// "$..name" / "..name[*]" selectors used for datasets 2-4), and, since
// `jsonStreaming` resets the stack for every top-level record, the same
// pattern also works unchanged across a whole ndjson file.
const filter = new RegExp(process.env.JSON_PATH || '');

// jsonStreaming lets the parser accept the concatenated top-level JSON
// values in an ndjson file (see stream-json's docs on JSON Streaming);
// for a single json document (TYPE === 'json', datasets 3-4) it must stay
// off so the one top-level array/object parses normally.
const pipeline = chain([
    parser({ jsonStreaming: TYPE === 'ndjson' }),
    pick({ filter }),
    streamValues(),
]);

stream.pipe(pipeline).
    on('data', (d) => meter.mark()).
    on('error', (err) => console.error(err.stack)).
    on('end', () => process.send && process.send({ end: true, rate: meter.toJSON() }));
