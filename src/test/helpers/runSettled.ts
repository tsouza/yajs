
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
        let grantedGrace = false;

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
        // The quiet-period timer starts counting from t=0 (see
        // scheduleSettle()'s first call below), racing the real event
        // pipeline (fs read -> parse -> emit) rather than starting only
        // once something has actually happened. Under normal load that
        // race is never close, but on a busy CI runner running hundreds of
        // these back to back it occasionally is: the timer fires and this
        // resolves with zero recorded events a few milliseconds before the
        // genuine (and correct) event actually arrives - a false "nothing
        // happened" result caused entirely by test-harness timing, not by
        // yajs itself (confirmed by hand: a fixture that flaked in CI this
        // way errored correctly and immediately in 10/10 unloaded local
        // runs). Rather than padding quietPeriodMs for every fixture
        // (measured cost: a blanket increase from 100ms to 250ms slowed
        // the ~300-fixture conformance suite from ~20s to ~45s+), grant
        // one extra quiet-period-length grace window specifically for the
        // zero-events case, which is the only one this race can produce -
        // a fixture that already recorded a real event isn't at risk of
        // this, and a fixture that's genuinely silent still settles after
        // the grace window (or the hard cap, whichever is sooner).
        const onQuietPeriodElapsed = () => {
            if (!grantedGrace && values.length === 0 && errors.length === 0 && !ended) {
                grantedGrace = true;
                settleTimer = setTimeout(onQuietPeriodElapsed, quietPeriodMs);
                return;
            }
            settle();
        };
        const scheduleSettle = () => {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(onQuietPeriodElapsed, quietPeriodMs);
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
