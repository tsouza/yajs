
import { createReadStream } from 'fs';
import { parse } from 'JSONStream';
import { Meter } from 'measured';
import { createGunzip } from 'zlib';

const meter = new Meter();
const stream = createReadStream(`./data/data-${process.env.DATA}.ndjson.gz`).
    pipe(createGunzip());

setInterval(() => process.send({ rate: meter.toJSON() }), 1000);

stream.pipe(parse(process.env.JSON_PATH)).
    on('data', (d) => meter.mark()).
    // tslint:disable-next-line:no-console
    on('error', (err) => console.error(err.stack)).
    on('end', () => process.send({ end: true }));
