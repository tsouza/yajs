
import { describe, expect, it } from 'vitest';

import { runSettled } from './helpers/runSettled';

// Regression tests for https://github.com/tsouza/yajs/issues/5 ("infinity loop").
//
// JsonSaxParser's hand-written state machine used to call charError() on
// malformed input without stopping the switch-case fallthrough, so a single
// bad byte could re-trigger the error handler forever (an unbounded stream
// of repeated errors, and in some states a true synchronous infinite loop
// that never returns control to the event loop). Each of these tests feeds
// genuinely malformed JSON through the public yajs() stream and asserts
// that parsing settles quickly with the failure reported exactly once,
// rather than a flood of errors.
//
// Note: once yajs() emits 'error', Node's Readable#pipe() unpipes and
// pauses the upstream source to protect the now-failed destination — that
// is standard Node stream behavior, not something this fix changes — so
// the source's 'end' event does not fire afterwards. These tests therefore
// settle on a short quiet period after the last error rather than waiting
// for 'end'. Each test also carries an explicit vitest timeout, which acts
// as the real backstop against a genuine synchronous infinite loop (vitest
// can terminate a hung test even if its event loop never yields).
describe('parser error handling', () => {

    it('should report a truncated number as a single error, not an ' +
        'unbounded stream', () =>
        runToSettled('error-truncated-number').then((errors) => {
            expect(errors).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
        }), 2000);

    it('should report an invalid leading symbol as a single error, not an ' +
        'unbounded stream', () =>
        runToSettled('error-bad-symbol').then((errors) => {
            expect(errors).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
        }), 2000);

    it('should report an unquoted object value as a single error, not an ' +
        'unbounded stream', () =>
        runToSettled('error-unquoted-value').then((errors) => {
            expect(errors).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
        }), 2000);
});

// Pipes a stream-tests fixture through yajs() and collects every 'error'
// event (instead of rejecting on the first one, since malformed input is
// expected to error). See helpers/runSettled.ts for why this settles on a
// quiet period rather than waiting on 'end'.
function runToSettled(json: string, path = '$'): Promise<Error[]> {
    return runSettled(`${__dirname}/stream-tests/${json}.json`, { path }).
        then((result) => result.errors);
}
