
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

// Regression tests for https://github.com/tsouza/yajs/issues/9 ("silent
// hang / zero signal on an unmatched closing bracket").
//
// StreamContext.endArray()/endObject() used to call
// this.position.stepOutArray()/stepOutObject() unconditionally. If a close
// token arrived before any startArray()/startObject()/onValue() had run,
// this.position was still `undefined`, so this threw a synchronous
// TypeError - which got swallowed somewhere in the through()/Readable-pipe
// plumbing instead of surfacing as an 'error' event: no 'data', no
// 'error', no 'end', exit code 0, as if parsing had simply produced no
// matches. StreamContext now tracks how many containers are actually open
// independently of its own (reset-per-array-element) position tracking,
// and reports a real structural error through the same onError callback
// plumbing JsonSaxParser already used for issue #5, instead of
// dereferencing `this.position` unconditionally.
describe('unmatched closing bracket (issue #9)', () => {

    it('should report a lone "]" (no matching open) as a single error, ' +
        'not a silent hang', () =>
        runToSettled('error-unmatched-close-array').then((errors) => {
            expect(errors).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
        }), 2000);

    it('should report a lone "}" (no matching open) as a single error, ' +
        'not a silent hang', () =>
        runToSettled('error-unmatched-close-object').then((errors) => {
            expect(errors).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
        }), 2000);

    it('should report a close with no matching open even after some ' +
        'otherwise-valid content ("[1]]")', () =>
        runToSettled('error-extra-close-after-valid-array').then((errors) => {
            expect(errors).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
        }), 2000);
});

// Regression test for a stale-buffered-string bug found during adversarial
// review of the issue #9 fix above.
//
// A completed string token is buffered (see flushPendingString() in
// yajs.ts) until a disambiguating token confirms it's actually the
// document's value - `,`/`:`/`]`/`}`, or end-of-stream. Once any error has
// been reported, that confirmation can never legitimately arrive, but
// end-of-stream used to call flushPendingString() unconditionally anyway -
// so a document like `"abc"]` (a bare string immediately followed by an
// unmatched `]`) reported the correct structural error AND ALSO emitted a
// spurious 'data' event for "abc" plus a clean 'end', as if parsing had
// partly succeeded on an invalid document.
describe('no stale data emitted after an error (found reviewing issue #9)', () => {

    it('should not emit a buffered string as data once an error has ' +
        'already invalidated it', () =>
        runSettled(`${__dirname}/stream-tests/error-stale-string-before-close-error.json`).
            then((result) => {
                expect(result.errors, result.errors.map((e) => e.message).join('; ')).
                    to.have.lengthOf(1);
                expect(result.values, JSON.stringify(result.values)).to.have.lengthOf(0);
            }), 2000);
});

// Regression test for https://github.com/tsouza/yajs/issues/8 ("OOM crash
// on deeply nested arrays at the root").
//
// StreamContext used to create a new ObjectDispatcher every time a "fresh
// candidate" was (mis-)detected at each level of a run of consecutive
// array/object opens, and dispatch() forwarded every subsequent event to
// *every* dispatcher accumulated so far - so a run of N consecutive opens
// did O(N) work per event for O(N) events, i.e. O(N^2) time, while also
// allocating O(N) duplicate copies of everything nested below each level -
// also O(N^2) memory. dispatch() now only ever forwards events to the
// single currently-active dispatcher, suspending/resuming ancestors on a
// LIFO stack instead, making both time and memory linear in nesting depth.
//
// This uses a bounded depth (5,000, balanced open/close) rather than the
// 100,000-unclosed-bracket depth from the original bug report - enough to
// clearly distinguish O(n) from O(n^2) (the pre-fix code took upwards of
// 14 seconds and multiple GB at this depth; see also the
// n_structure_100000_opening_arrays.json fixture in 06-conformance.ts for
// coverage closer to the original report's scale) without making this test
// itself slow, flaky, or capable of exhausting CI memory.
describe('deeply nested arrays stay linear, not quadratic (issue #8)', () => {

    it('should parse 5,000 levels of array nesting in well under a second, ' +
        'not the ~14s+ the pre-fix O(n^2) dispatcher fan-out took', () => {
        const start = Date.now();
        return runToSettled('deeply-nested-arrays').then((errors) => {
            const elapsedMs = Date.now() - start;
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(0);
            // Generous upper bound for a slow CI machine - the fix itself
            // measured well under 100ms locally; the old O(n^2) behavior
            // measured well over 10 *seconds* at this same depth, so this
            // comfortably distinguishes "fixed" from "regressed" without
            // being a tight, flake-prone timing assertion.
            expect(elapsedMs, `took ${elapsedMs}ms`).to.be.lessThan(3000);
        });
    }, 5000);
});

// Pipes a stream-tests fixture through yajs() and collects every 'error'
// event (instead of rejecting on the first one, since malformed input is
// expected to error). See helpers/runSettled.ts for why this settles on a
// quiet period rather than waiting on 'end'.
function runToSettled(json: string, path = '$'): Promise<Error[]> {
    return runSettled(`${__dirname}/stream-tests/${json}.json`, { path }).
        then((result) => result.errors);
}
