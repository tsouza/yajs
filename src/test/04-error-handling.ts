
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';
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

// Regression tests for https://github.com/tsouza/yajs/issues/50 ("NDJSON:
// one malformed document permanently and silently drops all subsequent
// valid documents").
//
// JsonSaxParser's ERROR state (see issue #5 above) used to be permanently
// terminal: once entered, every remaining byte was a no-op forever,
// regardless of how many more, individually-valid, NDJSON records followed
// the one that failed. Fixed by resyncing at the next newline after an
// error - see resyncAfterError() in JsonSaxParser.ts (and its counterpart
// in StreamContext.ts, invoked via the new onResync callback) - which
// abandons whatever was left of the failed record and starts tokenizing
// the next one as a fresh top-level document, while still guaranteeing the
// same forward-progress invariant issue #5's fix relies on (the ERROR case
// in parse()'s main loop never rewinds `i`, so it can never spin).
describe('NDJSON resyncs after a malformed record instead of dropping ' +
    'every later one (issue #50)', () => {

    it('should report the one bad record\'s error and still deliver every ' +
        'valid record after it, not go silent (issue\'s own repro)', () =>
        runSettled(`${__dirname}/stream-tests/error-ndjson-resync.json`).
            then((result) => {
                expect(result.errors, result.errors.map((e) => e.message).join('; ')).
                    to.have.lengthOf(1);
                expect(result.errors[0].message).to.match(/Unexpected/);
                expect(result.values.map((v: any) => v.value)).to.deep.equal([{ n: 1 }, { n: 3 }, { n: 4 }]);
            }), 2000);

    it('should recover even when the very first record is the malformed ' +
        'one', () =>
        runSettled(`${__dirname}/stream-tests/error-ndjson-resync-leading.json`).
            then((result) => {
                expect(result.errors, result.errors.map((e) => e.message).join('; ')).
                    to.have.lengthOf(1);
                expect(result.values.map((v: any) => v.value)).to.deep.equal([{ n: 2 }, { n: 3 }]);
            }), 2000);

    it('should resync correctly when a malformed record and a following ' +
        'valid one straddle a chunk boundary', () => {
        const values: any[] = [];
        const errors: Error[] = [];
        return new Promise<void>((resolve) => {
            const stream = yajs('$');
            stream.
                on('data', (d: any) => values.push(d.value)).
                on('error', (err: Error) => errors.push(err)).
                on('end', resolve);
            stream.write(Buffer.from('{"n":1}\n{"n":0'));
            stream.write(Buffer.from('2}\n{"n":3}\n'));
            stream.end();
        }).then(() => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(values).to.deep.equal([{ n: 1 }, { n: 3 }]);
        });
    }, 2000);

    // Single-document (non-NDJSON) behavior must be exactly unchanged: with
    // no newline anywhere after the error, there is no resync point, so the
    // ERROR state stays terminal exactly as issue #5 originally made it -
    // one error, nothing else, no hang.
    it('should still leave a single malformed document (no trailing ' +
        'newline) with exactly one error and no data', () =>
        runSettled(`${__dirname}/stream-tests/error-truncated-number.json`).
            then((result) => {
                expect(result.errors).to.have.lengthOf(1);
                expect(result.values).to.have.lengthOf(0);
            }), 2000);

    it('should still leave a single malformed document with a trailing ' +
        'newline (nothing after it) with exactly one error and no data, ' +
        'not a second spurious "no data" error', () => {
        const values: any[] = [];
        const errors: Error[] = [];
        return new Promise<void>((resolve) => {
            const stream = yajs('$');
            stream.
                on('data', (d: any) => values.push(d.value)).
                on('error', (err: Error) => errors.push(err)).
                on('end', resolve);
            stream.end(Buffer.from('{"n":02}\n'));
        }).then(() => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(values).to.have.lengthOf(0);
        });
    }, 2000);
});

// Regression tests for a gap in the issue #50 NDJSON resync above: when a
// record's first invalid byte is ITSELF the terminating newline (a string,
// number, or literal truncated at its own end-of-line - the most common
// end-of-line corruptions), that newline used to be consumed as the error
// character on its own loop iteration. The `case ERROR:` branch in parse()
// only ever sees SUBSEQUENT bytes, so the resync point silently became the
// FOLLOWING record's terminator - and that entire, individually-valid next
// record was consumed as garbage with no error and no data. Fixed in
// charError(): when the offending byte is `\n`, the resync point has
// already arrived - report the error, then resync immediately, so the very
// next byte starts a fresh document.
describe('NDJSON resync when the error byte is itself the newline ' +
    '(issue #50 follow-up)', () => {

    function runChunks(chunks: string[]): Promise<{ values: any[], errors: Error[] }> {
        const values: any[] = [];
        const errors: Error[] = [];
        return new Promise<void>((resolve) => {
            const stream = yajs('$');
            stream.
                on('data', (d: any) => values.push(d.value)).
                on('error', (err: Error) => errors.push(err)).
                on('end', resolve);
            for (const chunk of chunks) { stream.write(Buffer.from(chunk)); }
            stream.end();
        }).then(() => ({ values, errors }));
    }

    it('should not swallow the next record when a string is truncated at ' +
        'its own terminating newline', () =>
        runChunks(['"abc\n{"c":1}\n']).then(({ values, errors }) => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
            expect(values).to.deep.equal([{ c: 1 }]);
        }), 2000);

    it('should not swallow the next record when a number is truncated at ' +
        'its own terminating newline', () =>
        runChunks(['1.\n{"n":2}\n']).then(({ values, errors }) => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(values).to.deep.equal([{ n: 2 }]);
        }), 2000);

    it('should not swallow the next record when a literal is truncated at ' +
        'its own terminating newline', () =>
        runChunks(['tr\n{"n":2}\n']).then(({ values, errors }) => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(values).to.deep.equal([{ n: 2 }]);
        }), 2000);

    // One byte earlier and this is the ordinary issue #50 path (the error
    // byte is NOT the newline; the newline right after it is seen in the
    // ERROR state) - which already recovered correctly and must keep doing
    // so identically.
    it('should keep recovering identically when the error lands one byte ' +
        'BEFORE the newline (original issue #50 path)', () =>
        runChunks(['"abc\x01\n{"c":1}\n']).then(({ values, errors }) => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(values).to.deep.equal([{ c: 1 }]);
        }), 2000);

    it('should resync identically when the error newline arrives at the ' +
        'start of its own separate chunk', () =>
        runChunks(['"abc', '\n{"c":1}\n']).then(({ values, errors }) => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(values).to.deep.equal([{ c: 1 }]);
        }), 2000);

    // Single-document control: the error newline is the stream's very last
    // byte, so the immediate resync recovers into a document that never
    // arrives. Exactly one error - in particular, finish() must not pile a
    // spurious "no data" error on top just because the resync left the
    // tokenizer back in a clean START state at EOF (same `hadError`
    // reasoning as the trailing-newline test in the issue #50 block above).
    it('should report exactly one error (and no spurious "no data" at EOF) ' +
        'when the error newline is the last byte of the stream', () =>
        runChunks(['"abc\n']).then(({ values, errors }) => {
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(1);
            expect(errors[0].message).to.match(/Unexpected/);
            expect(values).to.have.lengthOf(0);
        }), 2000);
});

// Regression tests for https://github.com/tsouza/yajs/issues/56 ("bare
// top-level NDJSON string is lost when immediately followed by a record
// that errors mid-string").
//
// A completed top-level string value is buffered in yajs.ts's `strValue`
// until something disambiguates it from a possible (still-pending) object
// *key* - see flushPendingString() there. Every disambiguation point had a
// callback to flush it EXCEPT one: the whitespace-driven NDJSON record
// boundary (`AWAIT_DOC_AFTER_VALUE` -> `AWAIT_DOC_VALUE` in
// JsonSaxParser.ts, on seeing whitespace after a just-completed top-level
// value). Without a flush there, a bare string immediately followed - across
// just a newline, no comma - by a different kind of next record lost the
// string entirely: either silently discarded (onNumber/onBoolean/onNull/
// onStartArray/onStartObject all reset `strValue = null` without flushing)
// or, if that next record itself errors, made permanently unflushable by
// flushPendingString()'s own `!state.errored` guard - even though that
// guard exists to protect a string belonging to the record that is actually
// failing, not one from an earlier, already-complete record. Confirmed
// present on master before the NDJSON resync fix (PR #55/issue #50) too -
// pre-existing, not a resync regression. Fixed by adding JsonSaxParser's
// `onValueBoundary` callback, fired at exactly that whitespace-confirmed
// boundary, before any byte of the next record is parsed.
describe('bare top-level NDJSON string is not lost by a following record ' +
    '(issue #56)', () => {

    it('should still deliver a bare top-level string whose following ' +
        'record errors mid-string (issue\'s own repro), and recover a ' +
        'valid record after that via resync', () =>
        runSettled(`${__dirname}/stream-tests/error-ndjson-bare-string-then-mid-string-error.json`).
            then((result) => {
                expect(result.errors, result.errors.map((e) => e.message).join('; ')).
                    to.have.lengthOf(1);
                expect(result.errors[0].message).to.match(/Unexpected/);
                expect(result.values.map((v: any) => v.value)).to.deep.equal(['hello', 'third']);
            }), 2000);

    it('should still deliver a bare top-level string whose following ' +
        'record is an unterminated string with no trailing newline (no ' +
        'resync point at all)', () =>
        runSettled(`${__dirname}/stream-tests/error-ndjson-bare-string-then-unterminated.json`).
            then((result) => {
                expect(result.errors, result.errors.map((e) => e.message).join('; ')).
                    to.have.lengthOf(1);
                expect(result.values.map((v: any) => v.value)).to.deep.equal(['hello']);
            }), 2000);

    it('should still deliver a bare top-level string immediately followed ' +
        'by a differently-typed, perfectly valid record (no error at all)', () =>
        runSettled(`${__dirname}/stream-tests/ndjson-bare-string-then-mismatched-type.json`).
            then((result) => {
                expect(result.errors, result.errors.map((e) => e.message).join('; ')).
                    to.have.lengthOf(0);
                expect(result.values.map((v: any) => v.value)).to.deep.equal(['hello', 42]);
            }), 2000);

    it('should still suppress a buffered string with nothing legal ' +
        'attached directly after it in the SAME document (no whitespace, ' +
        'so no confirmation boundary is ever reached) - guards against a ' +
        'regression of the issue #9 stale-string fix above', () =>
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
// quiet period rather than waiting on 'end'. Not the same function as
// 06-conformance.ts's similarly-named-but-differently-shaped
// runToSettledConformance() (different defaults, different fixture-directory
// assumptions, deliberately renamed there to avoid the collision).
function runToSettled(json: string, path = '$'): Promise<Error[]> {
    return runSettled(`${__dirname}/stream-tests/${json}.json`, { path }).
        then((result) => result.errors);
}
