import * as AsciiTable from 'ascii-table';
import { fork } from 'child_process';
import { Stats } from 'fast-stats';
import * as humanizeDuration from 'humanize-duration';

const time = humanizeDuration.humanizer({
    language: 'shortEn',
    languages: {
      shortEn: {
        y() { return 'y'; },
        mo() { return 'mo'; },
        w() { return 'w'; },
        d() { return 'd'; },
        h() { return 'h'; },
        m() { return 'm'; },
        s() { return 's'; },
        ms() { return 'ms'; },
        decimal: '.',
      },
    },
  });

const tableDataset1 = createTable(1);
const tableDataset2 = createTable(2);
const tableDataset3 = createTable(3);
const tableDataset4 = createTable(4);

benchmark('yajs', 1, '$.field2.nested', tableDataset1).
then(() => benchmark('jsonstream', 1, 'field2.nested.*', tableDataset1)).
then(() => benchmark('oboe', 1, '!.field2.nested[*]', tableDataset1)).
then(() => console.log(tableDataset1.toString())).

then(() => benchmark('yajs', 2, '$..plugins', tableDataset2)).
then(() => benchmark('jsonstream', 2, '_source..plugins.*', tableDataset2)).
then(() => benchmark('oboe', 2, '!._source..plugins[*]', tableDataset2)).
then(() => console.log(tableDataset2.toString())).

then(() => benchmark('yajs', 3, '$..plugins', tableDataset3, 'json')).
then(() => benchmark('jsonstream', 3, '*._source..plugins.*', tableDataset3, 'json')).
then(() => benchmark('oboe', 3, '![*]._source..plugins[*]', tableDataset3, 'json')).
then(() => console.log(tableDataset3.toString())).

then(() => benchmark('yajs', 4, '$..array.deep1', tableDataset4, 'json')).
then(() => benchmark('jsonstream', 4, '*..array.*.deep1', tableDataset4, 'json')).
then(() => benchmark('oboe', 4, '!..array[*].deep1', tableDataset4, 'json')).
then(() => console.log(tableDataset4.toString()));

function benchmark(bench: string, dataset: number, path: string,
                   table: object, type: string = 'ndjson'): Promise<void> {
    const start = new Date().getTime();
    let count = 0;
    let completed = false;
    console.log(`${dataset}-${bench}`);
    return new Promise<void>((resolve, reject) => {
        const stats = new Stats();
        const child = fork(`./bench-${bench}.ts`, [], {
            env: { DATA: `${dataset}`, JSON_PATH: path, TYPE: type },
        }).
        on('message', (m) => {
            if (m.end) {
                completed = true;
                stats.push(m.rate.currentRate);
                const eps = stats.amean();
                let drop;
                if (bench === 'yajs') {
                    drop = '-';
                    table._base = eps;
                } else {
                    drop = (((table._base / eps) - 1) * 100).toFixed(2) + '%';
                }
                table.addRow(bench, 'Yes', time(new Date().getTime() - start),
                    (eps / 1000).toFixed(2) + 'K', drop);
                child.kill();
            } else {
                count = m.rate.count;
                console.log(`${dataset}-${bench}: ${count}`);
                stats.push(m.rate.currentRate);
            }
        }).on('exit', () => {
            if (!completed) {
                table.addRow(bench, 'No', '-', '-', '-');
            }
            resolve();
        });
    });
}

function createTable(dataset: number) {
    const table = new AsciiTable(`dataset ${dataset}`);
    table.setHeading('Library', 'Completed', 'Time', 'Avg EPS', '% Diff');
    return table;
}
