#!/usr/bin/env node
import yajs from './yajs';

const path = findPath();

let stream;
try {
    stream = yajs(path);
} catch (err) {
    // yajs(path) parses the selector synchronously, before any stream
    // exists - a bad selector (e.g. a typo, or an unquoted '$' mangled by
    // the shell) throws here rather than emitting an 'error' event, so it
    // needs its own handler instead of falling through to the stream's
    // 'error' listener below, which can never see it.
    process.exitCode = 1;
    process.stderr.write(`Invalid selector "${path}": ${err.message}\n`);
    process.exit();
}

process.stdin.
    pipe(stream).
    on('data', (data) => process.stdout.
        write(`${JSON.stringify((data as any).value)}\n`)).
    on('error', (err) => {
        process.exitCode = 1;
        process.stderr.write(err.stack);
    });

function findPath() {
    const argv = process.argv;
    const idx = argv.findIndex((s) => s.length && s[0] === '$');
    return argv.slice(idx).
        join('');
}
