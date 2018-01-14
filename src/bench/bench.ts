import * as AsciiTable from 'ascii-table';
import { fork } from 'child_process';
import { Stats } from 'fast-stats';

const tableDataset1 = createTable(1);
const tableDataset2 = createTable(2);

benchmark('yajs', 1, '$.field2.nested', tableDataset1).
then(() => benchmark('jsonstream', 1, 'field2.nested.*', tableDataset1)).
then(() => benchmark('oboe', 1, '!.field2.nested[*]', tableDataset1)).
then(() => console.log(tableDataset1.toString())).

then(() => benchmark('yajs', 2, '$..plugins', tableDataset2)).
then(() => benchmark('jsonstream', 2, '_source..plugins.*', tableDataset2)).
then(() => benchmark('oboe', 2, '!._source..plugins[*]', tableDataset2)).
then(() => console.log(tableDataset2.toString()));

function benchmark(bench: string, dataset: number, path: string, table: object): Promise<void> {
    const start = new Date().getTime();
    let count = 0;
    console.log(`${dataset}-${bench}`);
    return new Promise<void>((resolve, reject) => {
        const stats = new Stats();
        const child = fork(`./bench-${bench}.ts`, [], {
            env: { DATA: `${dataset}`, JSON_PATH: path },
        }).
        on('message', (m) => {
            if (m.end) {
                table.addRow(bench, new Date().getTime() - start,
                    count, stats.min, stats.max, stats.amean(),
                    stats.percentile(1),
                    stats.percentile(10),
                    stats.percentile(25),
                    stats.percentile(50),
                    stats.percentile(75),
                    stats.percentile(90),
                    stats.percentile(99));
                child.kill();
            } else {
                count = m.rate.count;
                console.log(`${dataset}-${bench}: ${count}`);
                stats.push(m.rate.currentRate);
            }
        }).on('exit', () => resolve());
    });
}

function createTable(dataset: number) {
    const table = new AsciiTable(`dataset ${dataset}`);
    table.setHeading('lib', 'time', 'count', 'min', 'max', 'mean',
                    'p01', 'p10', 'p25', 'p50',
                    'p75', 'p90', 'p99');
    return table;
}
