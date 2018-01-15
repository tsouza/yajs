import { createReadStream } from 'fs';
import { Meter } from 'measured';
import * as oboe from 'oboe';
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

let counter = 0;
const max = +process.env.DATA * 1000000;

oboe(stream).
    on('node', process.env.JSON_PATH, () => meter.mark()).
    fail((err) => console.error(err.stack)).
    done(() => {
        if (TYPE === 'json' || ++counter >= max) {
            process.send({ end: true, rate: meter.toJSON() });
        }
    });
