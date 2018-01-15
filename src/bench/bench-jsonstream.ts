
import { createReadStream } from 'fs';
import { parse } from 'JSONStream';
import { Meter } from 'measured';
import { createGunzip } from 'zlib';

const meter = new Meter();
const stream = createReadStream(`./data/data-${process.env.DATA}.ndjson.gz`).
    pipe(createGunzip());

if (process.send) {
    setInterval(() => process.send({ rate: meter.toJSON() }), 1000);
} else {
    setInterval(() => console.log({ rate: meter.toJSON() }), 1000);
}

stream.pipe(parse(process.env.JSON_PATH)).
    on('data', (d) => meter.mark()).
    // tslint:disable-next-line:no-console
    on('error', (err) => console.error(err.stack)).
    on('end', () => process.send && process.send({ end: true }));
