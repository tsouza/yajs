
import { createReadStream } from 'fs';
import { Meter } from 'measured';
import * as oboe from 'oboe';
import { createGunzip } from 'zlib';

const meter = new Meter();
const stream = createReadStream(`./data/data-${process.env.DATA}.ndjson.gz`).
    pipe(createGunzip());

setInterval(() => process.send({ rate: meter.toJSON() }), 1000);

let counter = 0;
const max = +process.env.DATA * 1000000;

oboe(stream).
    on('node', process.env.JSON_PATH, () => meter.mark()).
    // tslint:disable-next-line:no-console
    fail((err) => console.error(err.stack)).
    done(() => {
        if (counter++ === max) {
            process.send({ end: true });
        }
    });
