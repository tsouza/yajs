
import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';
import { runSettled } from './helpers/runSettled';

const FIXTURE_DIR = `${__dirname}/stream-tests/jsontestsuite`;

// Settles on a quiet period or a hard cap - see helpers/runSettled.ts for
// the rationale (a malformed-input regression could flood 'error' events
// or spin without yielding, so we can't just await 'end'; the hard cap also
// covers a fixture that produces zero events at all, i.e. a stream that
// hangs with no signal whatsoever).
//
// n_structure_100000_opening_arrays.json and n_structure_open_array_object.json
// are the fixtures that need longer windows than every other file here:
// parsing 100,000 `[` characters, or ~50,000 levels of `{"":[` nesting
// (250KB), produces *zero* 'data'/'error' events until the single
// structural error at end-of-stream (added by GitHub issue #11 - see
// UNCLOSED_STRUCTURE_NOT_DETECTED below), so - unlike every other fixture,
// which either errors quickly or genuinely has nothing left to do - the
// default 100ms quiet period (with no intervening event to push it back
// out) elapses and settles the run *before* that many bytes have even
// finished being read and tokenized, observed as a false "zero errors"
// result. Only these fixtures need the larger windows; every other file
// keeps the tight defaults that make a genuine hang/flood fail fast.
const LARGE_FIXTURES = new Set([
    'n_structure_100000_opening_arrays.json',
    'n_structure_open_array_object.json',
]);

function run(file: string) {
    return LARGE_FIXTURES.has(file) ?
        runSettled(`${FIXTURE_DIR}/${file}`, { quietPeriodMs: 1000, hardCapMs: 5000 }) :
        runSettled(`${FIXTURE_DIR}/${file}`, { quietPeriodMs: 100 });
}

function readUtf8(file: string): string {
    return readFileSync(`${FIXTURE_DIR}/${file}`, 'utf8');
}

// yajs streams the immediate elements of a matched *array* one at a time
// rather than emitting the whole array as a single value - confirmed both by
// the existing '$.object4.object5' test in 03-yajs.ts and empirically here: a
// root-level array never itself appears as an emitted `value`, only its
// elements do. Each element is captured as one WHOLE value, whatever it is -
// a scalar stays a scalar, an object is captured whole, and (since issue #14)
// an array is ALSO captured whole rather than being recursively flattened
// into its own leaves. An object (or scalar) at the top level, by contrast,
// *is* emitted as one whole value wherever it's matched - arrays are the only
// thing '$' iterates. This mirrors what a matched value is expected to look
// like coming out of yajs('$'), independent of any of the conformance gaps
// this suite found.
function expectedValues(parsed: any): any[] {
    return Array.isArray(parsed) ? parsed : [parsed];
}

// --------------------------------------------------------------------
// Fixture inventory: the nst/JSONTestSuite test_parsing/ corpus
// (https://github.com/nst/JSONTestSuite/tree/master/test_parsing), fetched
// in full from GitHub.
// n_structure_100000_opening_arrays.json (100,000 unclosed `[`) used to be
// deliberately excluded from the fixture directory entirely rather than
// merely skipped here: piping it through yajs('$') reliably OOM-crashed the
// Node process (even 20,000 unclosed arrays exceeded a 4GB heap) - a real
// O(n^2) bug in StreamContext's dispatcher bookkeeping on deeply-nested
// (unclosed or not) arrays. Fixed (GitHub issue #8): StreamContext now only
// ever forwards each event to the single currently-active dispatcher,
// suspending/resuming ancestors instead of re-dispatching to every
// dispatcher ever created, so both memory and per-event work are linear in
// nesting depth. The fixture is back in this directory (see its README)
// and runs through the same generic loop as everything else below.
// --------------------------------------------------------------------
const allFixtures = readdirSync(FIXTURE_DIR).sort();
const yFixtures = allFixtures.filter((f) => f.startsWith('y_'));
const nFixtures = allFixtures.filter((f) => f.startsWith('n_'));
const iFixtures = allFixtures.filter((f) => f.startsWith('i_'));

// --------------------------------------------------------------------
// Known conformance gaps.
//
// Every file below was run through the real assertion (via the generic
// loops), found to genuinely diverge from RFC 8259, and is deliberately
// re-run through `it.fails(...)`: the *inner* assertion is expected to
// fail, so the outer test goes green, but stays honest and self-updating -
// if a future fix makes yajs correct on one of these, `it.fails` flips to
// a hard failure demanding the entry be deleted, rather than the gap
// quietly staying "fixed but still marked broken" forever. Grouped by root
// cause, with each group's rationale documented in the comment above it.
// --------------------------------------------------------------------

// Formerly tracked here as a known gap (GitHub issue #49): the number
// tokenizer used to reconstruct the mantissa by repeated
// multiply-by-10-and-add on a plain JS `number` (NUMBER3/4/5/6/7/8 in
// JsonSaxParser), which accumulates rounding error differently than V8's
// correctly-rounded string-to-double conversion. Divergence showed up for
// numbers with many significant digits, and separately `-0` was lost
// entirely: `magnatude` started at plain `0`, and `0 * -1 === -0` is true in
// IEEE 754, so the sign *should* have survived `this.magnatude =
// -this.magnatude` - but NUMBER2 (the "seen a lone leading 0, nothing after
// it" state) dispatched via `this.callbacks.onNumber(0)` with a hardcoded
// literal, never consulting `this.negative` at all. Fixed by accumulating
// the raw number literal as text (`numStr`) while tokenizing and handing
// the complete literal to `Number()` once the token is known, instead of
// re-implementing decimal-to-double conversion by hand - see the comment on
// flushPendingNumber() in JsonSaxParser.ts. y_number_double_close_to_zero.json,
// y_number_minus_zero.json, and y_number_negative_zero.json (the fixtures
// that used to be flagged here) now all pass through the generic loop below
// like any other fixture.

// Formerly tracked here (GitHub issue #62): a bare `""` at the very end of
// the stream (nothing after the second quote) used to be misreported as
// truncated input. Root cause: the triple-double-quote extension needs one
// byte of lookahead past `""` to tell an empty string apart from the start
// of a `"""..."""` block (TDQSTR2), and finish() - called once the source
// ends with no more lookahead coming - had no case for TDQSTR2, so it fell
// through to the generic "Unexpected end of input stream" error instead of
// resolving the ambiguity in favor of "no third quote showed up, so it was
// just an empty string". Fixed by flushPendingTdqLookahead() in
// JsonSaxParser.ts's finish(), which also resolves the analogous TDQSTR6
// pending-flush state (a genuinely-closed `"""..."""` string ending exactly
// at EOF, e.g. the bare document `""""""`), found while fixing this.
// y_structure_string_empty.json now passes through the generic loop below
// like any other fixture.

// yajs's tokenizer used to never enforce the *grammar* between tokens -
// only individual tokens were validated character-by-character. Nothing
// checked that array/object elements were actually comma-separated, that
// object entries had a `key:` pair, that a closing bracket matched an open
// one, or that a number's leading digit wasn't 0. So e.g. `[1 2]` (no
// comma) was silently accepted as `[1, 2]`, `{"a" "b"}` (no colon)
// silently dropped the key, and `012` was accepted as a number with a
// disallowed leading zero.
//
// Fixed (GitHub issue #11): JsonSaxParser.ts now tracks an explicit
// structural stack (`structStack` + the `awaiting` cursor - see the
// AWAIT_*/FRAME_* constants and the comment block above them near the top
// of the file) recording exactly what's grammatically legal next - a
// value, an object key, `:`, `,`, or a close bracket - and reports a
// violation through the very same onError callback / ERROR terminal state
// that JsonSaxParser already used for within-token errors (issue #5). A
// disallowed leading zero is checked directly in the NUMBER2 token state
// (it's a within-token rule, not a between-token one). finish() now also
// checks, once a stream genuinely ends, that every `[`/`{` it dispatched
// was matched by a `]`/`}` and that at least one top-level value was ever
// seen.
//
// This closed all but one of the fixtures originally grouped under the six
// gap categories that used to live here (NO_COMMA_ENFORCEMENT,
// NO_COLON_OR_KEY_ENFORCEMENT, NO_LEADING_ZERO_ENFORCEMENT,
// NO_TRAILING_GARBAGE_ENFORCEMENT, and UNCLOSED_STRUCTURE_NOT_DETECTED are
// gone entirely - every member is now correctly rejected, including
// n_structure_open_array_object.json, ~50,000 levels of `{"":[` nesting:
// it needed no parser change beyond the fix above, just joining
// LARGE_FIXTURES near the top of the file so run()'s quiet period doesn't
// elapse - with zero 'data'/'error' events produced until the very end -
// before the real, now-correct terminal error has had time to arrive). The
// one survivor below is deliberate, not an oversight.
const NO_EXTRA_OR_TRAILING_COMMA_ENFORCEMENT = new Set([
    // n_structure_object_with_trailing_garbage.json (`{"a": true} "x"`) is
    // the one member of this group issue #11 does NOT fix, and can't
    // without giving something up on purpose: this library treats
    // whitespace-separated top-level values as NDJSON (see
    // src/test/stream-tests/ndjson.json and 03-yajs.ts) - a deliberate,
    // pre-existing extension over strict RFC 8259 (exactly one JSON text
    // per stream). A trailing `"x"` after `{"a": true}`, separated only by
    // a space, is grammatically indistinguishable from the start of a
    // second NDJSON record - rejecting it would mean rejecting legitimate
    // NDJSON input whenever a scalar value happens to follow a container.
    // Every other case originally grouped here (extra/trailing/double
    // commas, none of which have this ambiguity) is now correctly
    // rejected - see the dedicated regression test below.
    'n_structure_object_with_trailing_garbage.json',
]);

// Formerly tracked here as CRITICAL: a closing `]`/`}` with nothing open to
// close (more closes than opens) used to throw a synchronous TypeError from
// inside StreamContext.endArray()/endObject() (`this.position` was still
// `undefined` - no startArray/startObject/onValue had run to initialize
// it), swallowed somewhere in the through()/Readable-pipe plumbing with no
// 'data', no error text, and no crash visible to the caller (confirmed by
// hand: `echo ']' | node dist/main/index.js '$'` exited 0 with zero
// output). Fixed (GitHub issue #9): StreamContext now tracks how many
// object/array containers are actually open independently of its
// (reset-per-array-element) position tracking, and endArray()/endObject()
// report a real structural error through the same onError callback plumbing
// as JsonSaxParser - see src/test/04-error-handling.ts for the regression
// tests - instead of dereferencing `this.position` unconditionally.
// n_structure_end_array.json now correctly produces an 'error' event, so it
// no longer needs an entry in KNOWN_N_GAPS.

const KNOWN_Y_GAPS = new Map<string, Set<string>>();

const KNOWN_N_GAPS = new Map<string, Set<string>>([
    ['extra/trailing comma silently accepted', NO_EXTRA_OR_TRAILING_COMMA_ENFORCEMENT],
]);

function gapReason(file: string, gaps: Map<string, Set<string>>): string | undefined {
    for (const [reason, files] of gaps) {
        if (files.has(file)) { return reason; }
    }
    return undefined;
}

describe('JSON conformance (nst/JSONTestSuite corpus) - y_ (must parse)', () => {
    for (const file of yFixtures) {
        const reason = gapReason(file, KNOWN_Y_GAPS);
        const itFn = reason ? it.fails : it;
        itFn(reason ? `parses ${file} [KNOWN GAP: ${reason}]` : `parses ${file}`, async () => {
            const expected = expectedValues(JSON.parse(readUtf8(file)));
            const { values, errors } = await run(file);
            expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(0);
            expect(values.map((v) => v.value)).to.deep.equal(expected);
        }, 3000);
    }
});

describe('JSON conformance (nst/JSONTestSuite corpus) - n_ (must reject)', () => {
    for (const file of nFixtures) {
        const reason = gapReason(file, KNOWN_N_GAPS);
        const itFn = reason ? it.fails : it;
        itFn(reason ? `rejects ${file} [KNOWN GAP: ${reason}]` : `rejects ${file}`, async () => {
            const { errors } = await run(file);
            // Don't assert exact error text (over-fitting) - only that the
            // parser recognized the input as invalid. run() itself is what
            // guards against "spinning or hanging with no signal": it always
            // resolves, via a quiet period after the last event or a hard
            // cap, so reaching this assertion at all already proves the
            // stream settled rather than hanging.
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }, LARGE_FIXTURES.has(file) ? 8000 : 3000);
    }
});

describe('JSON conformance (nst/JSONTestSuite corpus) - i_ (implementation-defined)', () => {
    for (const file of iFixtures) {
        it(`handles ${file} deterministically without hanging or crashing`, async () => {
            // No y/n assertion on purpose: JSONTestSuite documents these as
            // cases where reasonable parsers disagree (huge exponents,
            // lone surrogates, overlong UTF-8, missing BOM handling, etc).
            // What we *do* require: yajs does something, settles instead of
            // hanging (best effort - an actual process crash can't be
            // caught in-process either way), and is deterministic - the
            // same input run twice produces the same shape of outcome both
            // times.
            const [first, second] = await Promise.all([run(file), run(file)]);
            const shape = (r: RunResult) => ({
                errored: r.errors.length > 0,
                valueCount: r.values.length,
                values: r.values.map((v) => v.value),
            });
            expect(shape(first)).to.deep.equal(shape(second));
        }, 3000);
    }
});

// --------------------------------------------------------------------
// Dedicated regressions for GitHub issue #11 (structural/grammar
// validation between tokens), one per gap category the generic n_ loop
// above used to carry as a KNOWN_N_GAPS entry. The generic loop already
// exercises every one of these fixtures on every `npm test` run (that's
// the whole point of un-flagging them), so this block is deliberately
// redundant with it - it exists so each category has an explicit, named,
// easy-to-find test (matching the style of 04-error-handling.ts) that
// can't silently go missing if the generic loop or its fixture directory
// is ever reorganized. Each test pipes the actual corpus fixture - not a
// hand-rolled restatement of it - through yajs('$'), per the task's
// instruction to use the corpus itself as the source of truth. A few
// tests also assert the exact minimal repro from the issue report itself,
// since the corpus fixtures are all wrapped in an array/object and the
// issue's own examples are worth pinning down verbatim too.
// --------------------------------------------------------------------
describe('structural grammar validation regressions (issue #11)', () => {
    it('rejects a missing comma between array elements ([1 true])', () =>
        runToSettled('n_array_1_true_without_comma.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a missing comma between object entries ({"x", null})', () =>
        runToSettled('n_object_comma_instead_of_colon.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a trailing comma before a closing bracket ({"id":0,})', () =>
        runToSettled('n_object_trailing_comma.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a double comma between array elements ([1,,2])', () =>
        runToSettled('n_array_double_comma.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a missing colon after an object key ({"a" "b"})', () =>
        runToSettled('n_object_no-colon.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a non-string object key ({1:1})', () =>
        runToSettled('n_object_non_string_key.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a disallowed leading zero ([012])', () =>
        runToSettled('n_number_with_leading_zero.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a disallowed leading zero on a negative number ([-012])', () =>
        runToSettled('n_number_neg_int_starting_with_zero.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects garbage immediately following a complete array ([1]] / [][])', () =>
        Promise.all([
            runToSettled('n_array_extra_close.json'),
            runToSettled('n_structure_double_array.json'),
        ]).then(([extraClose, doubleArray]) => {
            expect(extraClose.length, 'expected at least one error event').to.be.greaterThan(0);
            expect(doubleArray.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a close bracket with nothing open to close (])', () =>
        runToSettled('n_structure_close_unopened_array.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects a stream that ends while a structure is still open ({"a":"a")', () =>
        runToSettled('n_structure_unclosed_object.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    it('rejects an empty/whitespace-only document (a single space)', () =>
        runToSettled('n_single_space.json').then((errors) => {
            expect(errors.length, 'expected at least one error event').to.be.greaterThan(0);
        }));

    // The four repro commands from the GitHub issue itself, run through the
    // real public yajs() API rather than a corpus fixture file, since two
    // of them (the leading zero and the unclosed-at-EOF case) are simpler
    // than any wrapped corpus equivalent and are worth pinning verbatim.
    it('rejects the exact repros from the issue report', async () => {
        const cases = [
            '[1 true]', // no comma between array elements
            '{"a" "b"}', // no colon between key and value
            '{"a":', // unclosed at EOF
            '01', // disallowed leading zero
        ];
        for (const json of cases) {
            const errors: Error[] = [];
            await new Promise<void>((resolve) => {
                const stream = yajs('$');
                stream.
                    on('data', () => undefined).
                    on('error', (err: Error) => errors.push(err)).
                    on('end', resolve).
                    on('close', resolve);
                stream.end(Buffer.from(json));
            });
            expect(errors.length, `expected an error for ${JSON.stringify(json)}`).to.be.greaterThan(0);
        }
    });

    // NDJSON (multiple whitespace/newline-separated top-level values) is a
    // deliberate, pre-existing extension this library supports (see
    // src/test/stream-tests/ndjson.json and the "should parse ndjson" test
    // in 03-yajs.ts) and must keep working: the structural fix above must
    // not mistake "the next NDJSON record is starting" for trailing
    // garbage after the previous one.
    it('still accepts whitespace-separated top-level values (NDJSON)', async () => {
        const values: any[] = [];
        const errors: Error[] = [];
        await new Promise<void>((resolve) => {
            const stream = yajs('$');
            stream.
                on('data', (d: any) => values.push(d.value)).
                on('error', (err: Error) => errors.push(err)).
                on('end', resolve);
            stream.end(Buffer.from('{"a":1}\n{"a":2}\n'));
        });
        expect(errors, errors.map((e) => e.message).join('; ')).to.have.lengthOf(0);
        expect(values).to.deep.equal([{ a: 1 }, { a: 2 }]);
    });
});

// Collects every 'error' event a corpus fixture produces, the same way the
// generic n_ loop above does (via run()/runSettled()), but as a plain
// array instead of the full RunResult - convenient for the dedicated,
// single-assertion regressions above.
function runToSettled(file: string): Promise<Error[]> {
    return run(file).then((result) => result.errors);
}
