
import { readdirSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { runSettled } from './helpers/runSettled';

const FIXTURE_DIR = `${__dirname}/stream-tests/jsontestsuite`;

// Settles on a quiet period or a hard cap - see helpers/runSettled.ts for
// the rationale (a malformed-input regression could flood 'error' events
// or spin without yielding, so we can't just await 'end'; the hard cap also
// covers a fixture that produces zero events at all, i.e. the "silent
// hang" conformance gap documented below).
function run(file: string) {
    return runSettled(`${FIXTURE_DIR}/${file}`, { quietPeriodMs: 100 });
}

function readUtf8(file: string): string {
    return readFileSync(`${FIXTURE_DIR}/${file}`, 'utf8');
}

// yajs streams the elements of a matched *array* one at a time rather than
// emitting the whole array as a single value - confirmed both by the
// existing '$.object4.object5' test in 03-yajs.ts and empirically here: a
// root-level array never itself appears as an emitted `value`, only its
// (recursively-flattened, for nested arrays) leaves do. An object, by
// contrast, *is* emitted as one whole value wherever it's matched. This
// mirrors what a matched value is expected to look like coming out of
// yajs('$'), independent of any of the conformance gaps this suite found.
function expectedValues(parsed: any): any[] {
    if (Array.isArray(parsed)) {
        return parsed.flatMap(expectedValues);
    }
    return [parsed];
}

// --------------------------------------------------------------------
// Fixture inventory: the nst/JSONTestSuite test_parsing/ corpus
// (https://github.com/nst/JSONTestSuite/tree/master/test_parsing), fetched
// in full from GitHub.
// One file, n_structure_100000_opening_arrays.json (100,000 unclosed `[`),
// is deliberately excluded from the fixture directory entirely rather than
// merely skipped here: piping it through yajs('$') reliably OOM-crashes
// the Node process (confirmed by hand: even 20,000 unclosed arrays exceeds
// a 4GB heap) - a real bug in StreamContext's dispatcher-accumulation logic
// on deeply-nested unclosed arrays, not specific to this one fixture. A
// fixture that can take down the whole `npm test` run can't responsibly
// live inside the generic loop that executes every file.
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

// yajs's SAX tokenizer treats every input byte as one UTF-16 code unit
// (`String.fromCharCode(buffer[i])` in JsonSaxParser's string states)
// instead of UTF-8-decoding multi-byte sequences. Any *raw* (non
// `\uXXXX`-escaped) non-ASCII character in a JSON string round-trips as
// mojibake - one garbled code unit per UTF-8 byte - rather than the
// intended code point. This is likely the highest-impact gap in this
// whole suite: real-world JSON overwhelmingly encodes non-ASCII text as
// raw UTF-8, not \u-escapes.
const UTF8_MOJIBAKE = new Set([
    'y_string_nonCharacterInUTF-8_U+10FFFF.json',
    'y_string_nonCharacterInUTF-8_U+FFFF.json',
    'y_string_pi.json',
    'y_string_reservedCharacterInUTF-8_U+1BFFF.json',
    'y_string_u+2028_line_sep.json',
    'y_string_u+2029_par_sep.json',
    'y_string_unicode_2.json',
    'y_string_utf8.json',
]);

// The number tokenizer reconstructs the mantissa by repeated
// multiply-by-10-and-add on a plain JS `number` (NUMBER3/4/5/6/7/8 in
// JsonSaxParser), which accumulates rounding error differently than V8's
// correctly-rounded string-to-double conversion. Divergence shows up for
// numbers with many significant digits, and separately `-0` is lost
// entirely: `magnatude` starts at plain `0`, and `0 * -1 === -0` is true in
// IEEE 754, so the sign *should* survive `this.magnatude = -this.magnatude`
// - but NUMBER2 (the "seen a lone leading 0, nothing after it" state)
// dispatches via `this.callbacks.onNumber(0)` with a hardcoded literal,
// never consulting `this.negative` at all.
const NUMBER_PRECISION = new Set([
    'y_number_double_close_to_zero.json', // -1e-78 rounds to -1.0000000000000005e-78
    'y_number_minus_zero.json', // -0 -> +0
    'y_number_negative_zero.json', // -0 -> +0
]);

// A bare `""` at the very end of the stream (nothing after the second
// quote) is misreported as truncated input. Root cause: the triple-double-
// quote extension needs one byte of lookahead past `""` to tell an empty
// string apart from the start of a `"""..."""` block (TDQSTR2), and
// finish() - called once the source ends with no more lookahead coming -
// has no case for TDQSTR2, so it falls through to the generic "Unexpected
// end of input stream" error instead of resolving the ambiguity in favor
// of "no third quote showed up, so it was just an empty string".
const EMPTY_STRING_AT_EOF = new Set([
    'y_structure_string_empty.json',
]);

// yajs's tokenizer never enforces the *grammar* between tokens - only
// individual tokens are validated character-by-character. Nothing checks
// that array/object elements are actually comma-separated, that object
// entries have a `key:` pair, that a closing bracket matches an open one,
// or that a number's leading digit isn't 0. So e.g. `[1 2]` (no comma) is
// silently accepted as `[1, 2]`, `{"a" "b"}` (no colon) silently drops the
// key, and `012` is accepted as if it were two root-level numbers `0`,
// `1`, `2`. This is by far the largest single class of gap found here -
// no comment repeats the same explanation per file; grouped below by the
// grammar rule that goes unenforced.
const NO_COMMA_ENFORCEMENT = new Set([
    'n_array_1_true_without_comma.json',
    'n_array_colon_instead_of_comma.json',
    'n_array_comma_and_number.json',
    'n_array_inner_array_no_comma.json',
    'n_array_items_separated_by_semicolon.json',
    'n_array_missing_value.json',
    'n_array_newlines_unclosed.json',
    'n_array_number_and_comma.json',
    'n_array_number_and_several_commas.json',
    'n_array_unclosed_with_new_lines.json',
    'n_object_comma_instead_of_colon.json',
    'n_object_missing_semicolon.json',
    'n_object_non_string_key.json',
    'n_object_non_string_key_but_huge_number_instead.json',
    'n_object_repeated_null_null.json',
    'n_object_with_single_string.json',
    'n_structure_angle_bracket_..json',
    'n_structure_angle_bracket_null.json',
]);

const NO_EXTRA_OR_TRAILING_COMMA_ENFORCEMENT = new Set([
    'n_array_comma_after_close.json',
    'n_array_double_comma.json',
    'n_array_double_extra_comma.json',
    'n_array_extra_comma.json',
    'n_array_unclosed_trailing_comma.json',
    'n_object_double_colon.json',
    'n_object_several_trailing_commas.json',
    'n_object_trailing_comma.json',
    'n_object_two_commas_in_a_row.json',
    'n_structure_object_with_trailing_garbage.json',
]);

const NO_COLON_OR_KEY_ENFORCEMENT = new Set([
    'n_object_bracket_key.json',
    'n_object_missing_key.json',
    'n_object_missing_value.json',
    'n_object_no-colon.json',
    'n_object_lone_continuation_byte_in_key_and_trailing_comma.json',
]);

const NO_LEADING_ZERO_ENFORCEMENT = new Set([
    'n_number_-01.json',
    'n_number_1_000.json',
    'n_number_neg_int_starting_with_zero.json',
    'n_number_with_leading_zero.json',
]);

// No trailing-garbage-after-a-complete-document check: once a value at
// depth 0 completes, yajs just starts parsing whatever comes next as a
// *new* top-level value (this is deliberate elsewhere - it's what makes
// NDJSON streaming work at all - but it also means genuinely malformed
// trailing content after a single document is silently accepted).
const NO_TRAILING_GARBAGE_ENFORCEMENT = new Set([
    'n_array_extra_close.json',
    'n_array_incomplete.json',
    'n_object_garbage_at_end.json',
    'n_single_space.json',
    'n_structure_array_with_extra_array_close.json',
    'n_structure_close_unopened_array.json',
    'n_structure_comma_instead_of_closing_brace.json',
    'n_structure_double_array.json',
    'n_structure_object_followed_by_closing_object.json',
]);

// Nothing tracks bracket-nesting balance at end-of-stream: JsonSaxParser's
// own `finish()` only inspects its *token* state (mid-number, mid-string,
// etc), never whether every `[`/`{` it dispatched was ever matched by a
// `]`/`}`. So an input that ends while still "open" just ends the stream
// with no data and no error - never flagged as truncated.
const UNCLOSED_STRUCTURE_NOT_DETECTED = new Set([
    'n_array_just_comma.json',
    'n_array_unclosed_with_object_inside.json',
    'n_structure_lone-open-bracket.json',
    'n_structure_no_data.json',
    'n_structure_object_unclosed_no_value.json',
    'n_structure_open_array_comma.json',
    'n_structure_open_array_object.json',
    'n_structure_open_array_open_object.json',
    'n_structure_open_array_string.json',
    'n_structure_open_object.json',
    'n_structure_open_object_close_array.json',
    'n_structure_open_object_comma.json',
    'n_structure_open_object_open_array.json',
    'n_structure_unclosed_array.json',
    'n_structure_unclosed_object.json',
]);

// CRITICAL: a closing `]`/`}` with *nothing open to close* (more closes
// than opens) throws a synchronous TypeError from inside
// StreamContext.endArray()/endObject() (`this.position` is still
// `undefined` - no startArray/startObject/onValue ever ran to initialize
// it). Confirmed by hand through the real CLI path
// (`echo ']' | node dist/main/index.js '$'`): no 'data', no error text, no
// crash visible to the caller, exit code 0 - the throw is swallowed
// somewhere in the through()/Readable-pipe plumbing and the process just
// exits as if nothing happened. That's strictly worse than the
// already-fixed infinite-CPU-loop bug (04-error-handling.ts): at least
// that one kept the process visibly busy; this one looks identical to
// "ran successfully with no matches" to any caller.
//
// Only a genuine "close before any open" input reproduces this. The other
// four fixtures originally lumped in here do NOT hang or crash - verified
// by hand, each one settles within milliseconds:
//   - open_array_open_string.json (`["a`) actually parses correctly
//     (produces the expected truncated-stream error and ends) - not a bug,
//     not listed as a gap at all.
//   - open_array_object.json / open_array_open_object.json /
//     open_array_string.json all silently end with *no* error at all
//     (never throw, never hang) - that's the *unclosed-structure* gap
//     already tracked below via UNCLOSED_STRUCTURE_NOT_DETECTED, not this
//     one, so they're filed there instead.
const SILENT_HANG_ON_UNMATCHED_CLOSE = new Set([
    'n_structure_end_array.json',
]);

const KNOWN_Y_GAPS = new Map<string, Set<string>>([
    ['UTF-8 raw bytes mis-decoded as mojibake', UTF8_MOJIBAKE],
    ['number precision / sign-of-zero lost', NUMBER_PRECISION],
    ['bare "" at end of stream misreported as truncated', EMPTY_STRING_AT_EOF],
]);

const KNOWN_N_GAPS = new Map<string, Set<string>>([
    ['missing required comma/colon silently accepted', NO_COMMA_ENFORCEMENT],
    ['extra/trailing comma silently accepted', NO_EXTRA_OR_TRAILING_COMMA_ENFORCEMENT],
    ['missing/malformed object key or colon silently accepted', NO_COLON_OR_KEY_ENFORCEMENT],
    ['disallowed leading zero silently accepted', NO_LEADING_ZERO_ENFORCEMENT],
    ['trailing garbage after a complete document silently accepted', NO_TRAILING_GARBAGE_ENFORCEMENT],
    ['unclosed array/object at end-of-stream not detected', UNCLOSED_STRUCTURE_NOT_DETECTED],
    ['CRITICAL: unmatched closing bracket hangs the stream with zero signal', SILENT_HANG_ON_UNMATCHED_CLOSE],
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
        }, 3000);
    }
});

describe('JSON conformance (nst/JSONTestSuite corpus) - i_ (implementation-defined)', () => {
    for (const file of iFixtures) {
        it(`handles ${file} deterministically without hanging or crashing`, async () => {
            // No y/n assertion on purpose: JSONTestSuite documents these as
            // cases where reasonable parsers disagree (huge exponents,
            // lone surrogates, overlong UTF-8, missing BOM handling, etc).
            // What we *do* require: yajs does something, settles instead of
            // hanging (best effort - a hard process crash, as happens for
            // the excluded 100k-array fixture, can't be caught in-process
            // either way), and is deterministic - the same input run twice
            // produces the same shape of outcome both times.
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
