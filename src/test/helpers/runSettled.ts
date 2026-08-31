
import { createReadStream } from 'fs';

import yajs from '../../main/yajs';

export interface RunSettledResult {
    values: any[];
    errors: Error[];
    ended: boolean;
}

export interface RunSettledOptions {
    path?: string;
    quietPeriodMs?: number;
    hardCapMs?: number;
}

// Pipes a fixture file through yajs() and collects everything that happens,
// resolving once the stream quiets down (no new event for quietPeriodMs) or
// once hardCapMs elapses, whichever comes first.
//
// This is deliberately tolerant of malformed input: it collects every
// 'error' event instead of rejecting on the first one, and never waits on
// 'end' alone, because once yajs() emits 'error', Node's Readable#pipe()
// unpipes and pauses the upstream source to protect the failed destination
// (standard Node stream behavior) - 'end' does not fire afterwards. Each
// new event pushes the quiet-period window back out, so a parser that
// regresses to a flood of errors (or a genuine synchronous infinite loop)
// never reaches a quiet period; the hard cap - and each call site's own
// vitest timeout, the real backstop against a synchronous spin that never
// yields - is what keeps such a regression from hanging the suite. The
// hard cap also covers the case of a fixture that produces zero events at
// all (neither 'data' nor 'error' nor 'end').
export function runSettled(filePath: string, opts: RunSettledOptions = {}): Promise<RunSettledResult> {
    const { path = '$', quietPeriodMs = 200, hardCapMs = 1500 } = opts;
    const source = createReadStream(filePath);
    const target = yajs(path);
    return new Promise<RunSettledResult>((resolve) => {
        const values: any[] = [];
        const errors: Error[] = [];
        let ended = false;
        let settleTimer: ReturnType<typeof setTimeout>;
        let settled = false;

        const settle = () => {
            if (settled) { return; }
            settled = true;
            clearTimeout(settleTimer);
            clearTimeout(hardCapTimer);
            // Release the source fd and drop all listeners promptly rather
            // than leaving them to be garbage-collected - this suite opens
            // hundreds of these back to back (the JSONTestSuite corpus), and
            // leaked listeners/handles across that many runs risk perturbing
            // later tests' event-loop timing.
            source.destroy();
            target.removeAllListeners();
            resolve({ values, errors, ended });
        };
        const scheduleSettle = () => {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(settle, quietPeriodMs);
        };

        const hardCapTimer = setTimeout(settle, hardCapMs);
        scheduleSettle();

        source.
            pipe(target).
            on('data', (d: any) => { values.push(d); scheduleSettle(); }).
            on('error', (err: Error) => { errors.push(err); scheduleSettle(); }).
            on('end', () => { ended = true; settle(); });
    });
}
