import { createReadStream } from 'fs';
import { Meter } from 'measured';
import { createGunzip } from 'zlib';
import yajs from '../main/yajs';

const TYPE = process.env.TYPE || 'ndjson';
const meter = new Meter();
const stream = createReadStream(`./data/data-${process.env.DATA}.${TYPE}.gz`).
    pipe(createGunzip());

if (process.send) {
    setInterval(() => process.send({ rate: meter.toJSON() }), 1000);
} else {
    setInterval(() => console.log({ rate: meter.toJSON() }), 1000);
}

stream.pipe(yajs(process.env.JSON_PATH)).
    on('data', (d) => meter.mark()).
    on('error', (err) => console.error(err.stack)).
    on('end', () => process.send && process.send({ end: true, rate: meter.toJSON() }));
