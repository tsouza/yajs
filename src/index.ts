import yajs from './yajs';

const path = findPath();

process.stdin.
    pipe(yajs(path)).
    on('data', (data) => process.stdout.
        write(`${JSON.stringify((data as any).value)}\n`)).
    on('error', (err) => process.stderr.write(err.stack));

function findPath() {
    const argv = process.argv;
    const idx = argv.findIndex((s) => s.length && s[0] === '$');
    return argv.slice(idx).
        join('');
}
