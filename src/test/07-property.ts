import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

// A JSON-serializable value arbitrary, constrained relative to fc.jsonValue():
//
// - maxDepth is capped to keep the character-by-character SAX parser fast
//   across hundreds of runs (deep nesting is already exercised by the
//   dedicated example-based tests, not the concern of this property).
// - Numbers are restricted to fc.integer() - deliberately excluding
//   fc.float()/fc.double(). This is NOT routing around expected
//   floating-point noise (e.g. NaN/Infinity not being valid JSON) - it is
//   avoiding a genuine, verified precision bug in yajs's own number parser.
//   src/main/lib/utils/JsonSaxParser.ts accumulates the mantissa digit by
//   digit and, for a value with an exponent, finishes with
//   `this.magnatude *= Math.pow(10, this.exponent)` (see around line 472).
//   That is not how correctly-rounded decimal-to-double parsing works, and
//   it measurably isn't: a manual fuzz run of 20000 random doubles with
//   exponents in just [-10, 10] (nothing exotic - ordinary numbers like
//   -26491.059396597953 or 963160204.3665955) found yajs's parsed value
//   differed from the value JSON.stringify produced roughly 59% of the
//   time, always by a small number of ULPs (e.g. `963160204.3665955` comes
//   back as `963160204.3665954`). Even fixed low-digit decimals aren't
//   safe: `JSON.stringify(0.3)` is `"0.3"`, which native JSON.parse reads
//   back as exactly `0.3`, but yajs reads it back as
//   `0.30000000000000004`. fc.integer() sidesteps this because yajs's
//   digit-by-digit accumulation for a plain integer mantissa (no decimal
//   point, no exponent, so the lossy `Math.pow` step never runs) is exact
//   for values in JS's safe-integer range, which is exactly the range
//   fc.integer()'s default bounds live in. See remainingIssues in the task
//   report for the full writeup and a dedicated regression test just
//   below.
const jsonPrimitive = fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.string(),
);

// Object *keys* additionally exclude every name Object.prototype itself
// carries (constructor, toString, valueOf, hasOwnProperty, __proto__, ...)
// - see the comments below rootSafeValueArbitrary for the two distinct
// bugs this works around. Values are unrestricted (jsonPrimitive above,
// used for both keys' string type and values' string type, has no such
// exclusion - only where a string is used as an object *key* does this
// class of name cause trouble).
const RESERVED_OBJECT_PROTOTYPE_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));
const jsonKeyArbitrary = fc.string().filter((key) => !RESERVED_OBJECT_PROTOTYPE_KEYS.has(key));

const jsonValueArbitrary = fc.letrec<{ value: unknown }>((tie) => ({
    value: fc.oneof(
        { depthIdentifier: 'json' },
        jsonPrimitive,
        fc.array(tie('value'), { maxLength: 8 }),
        fc.dictionary(jsonKeyArbitrary, tie('value'), { maxKeys: 8 }),
    ),
})).value;

// yajs streams the elements of a matched *array* one at a time rather than
// buffering and emitting the whole array as a single value (confirmed both
// by manual probing here and by the existing '$.object4.object5' test in
// 03-yajs.ts, which asserts one emission per array element, not one
// emission of the array). That is presumably intentional - it is the whole
// point of a streaming parser that a huge top-level array need not be
// buffered in memory - but it means "$" does not reconstruct a document
// whose root value is itself a bare array (and, consistently with the
// element-streaming behavior, an empty root array yields zero emissions
// rather than one emission of `[]`). Arrays nested inside an object or
// another array are unaffected - they are only ever collected as part of
// an ancestor's value, never dispatched as a match in their own right -
// so this generator only needs to keep a bare array from being the
// document's outermost shape.
//
// Separately, a document whose entire content is exactly the two bytes `""`
// (an empty string, and *nothing* else - no trailing newline, no wrapping
// container) also cannot be parsed at all: it fails with "Unexpected end
// of input stream", for both a single write and any chunking. Root cause,
// in src/main/lib/utils/JsonSaxParser.ts: reading `""` first lands the
// state machine in TDQSTR2 ("saw two quotes - is a third quote about to
// start a triple-quoted string, or is this an empty string followed by
// something else?"), which needs to peek at the *next* byte to decide.
// When that next byte is available in the buffer (a real document always
// has one - `,`, `}`, `]`, or whitespace follows any value that isn't the
// very last thing in the stream) the lookahead resolves cleanly and empty
// strings parse fine, as confirmed by `{"a":""}`, `["",""]`, and `""\n`
// all round-tripping correctly. But when `""` is the last two bytes ever
// written (true only when an empty string is the *entire* document, with
// no wrapping array/object to supply a trailing bracket), that lookahead
// byte never arrives, `finish()` finds the state machine parked in
// TDQSTR2 instead of START, and reports a bogus truncation error on
// perfectly valid, complete JSON. See the dedicated regression test below.
//
// Two more, unrelated bugs rule out any Object.prototype property name
// (constructor, toString, valueOf, hasOwnProperty, __proto__, ...) as an
// object key anywhere in the generated tree (see jsonKeyArbitrary above) -
// both are instances of the same root mistake (treating a plain `{}` as a
// hash map without guarding against its inherited properties), just in two
// different places:
//
// 1. `{"__proto__":{"a":1}}` specifically: yajs's object builder
//    (AbstractObjectBuilder's ObjectNode.handle, in
//    src/main/lib/dispatcher/AbstractObjectBuilder.ts) assembles each
//    object with a plain `this.value[key] = value` assignment. For the key
//    "__proto__" that doesn't create a data property - it invokes the
//    inherited Object.prototype accessor, which sets the object's own
//    [[Prototype]] instead - so `{"__proto__":{"a":1}}` silently
//    reconstructs as `{}`, not `{ __proto__: { a: 1 } }`. Native
//    JSON.parse doesn't have this problem because (since ES2015) it
//    defines object properties with CreateDataProperty/defineProperty
//    semantics instead of a plain `[[Set]]`.
//
// 2. Any of the other names, e.g. `{"valueOf":false}`: unrelated to
//    "__proto__" and to selector projection entirely - it reproduces with
//    plain "$", no `<...>` drop-keys syntax in the path at all. In
//    AbstractObjectBuilder.startObjectEntry, `dropKeys` (empty here) is
//    turned into a lookup table with
//    `(dropKeys || []).reduce((obj, val) => { obj[val] = true; return obj; }, {})`,
//    and membership is then tested with the plain truthiness of
//    `this.mDropKeys[key]`. For key "valueOf" that expression evaluates to
//    the *inherited* `Object.prototype.valueOf` function reference (a
//    truthy value) rather than `undefined`, even though "valueOf" was
//    never actually listed as a key to drop - so the object builder
//    concludes it should drop this entry, and `{"valueOf":false}` silently
//    reconstructs as `{}`. The fix in both spots is the same:  build the
//    lookup table with `Object.create(null)` (or check via
//    `Object.prototype.hasOwnProperty.call(...)`) instead of a plain `{}`.
//
// See the dedicated regression tests below for both.
const rootSafeValueArbitrary = fc.oneof(
    jsonPrimitive,
    fc.dictionary(jsonKeyArbitrary, jsonValueArbitrary, { maxKeys: 8 }),
).filter((value) => value !== '');

const NUM_RUNS = 150;

describe('yajs property-based round-trip', () => {

    it('reconstructs the exact value JSON.parse would produce, for any JSON-serializable value', () =>
        fc.assert(
            fc.asyncProperty(rootSafeValueArbitrary, async (value) => {
                const json = JSON.stringify(value);
                const expected = JSON.parse(json);

                const actual = await runYajs(Buffer.from(json));

                expect(actual).to.have.lengthOf(1);
                expect(actual[0].path).to.be.empty;
                expect(actual[0].value).to.deep.equal(expected);
            }),
            { numRuns: NUM_RUNS },
        ));

    it('produces the same result regardless of how the input is chunked', () =>
        fc.assert(
            fc.asyncProperty(
                // Filtered the same way as rootSafeValueArbitrary above (see the
                // comment there): a document whose whole content is the literal
                // empty string `""` can't be parsed at all - by yajs, in a
                // single write, chunked or not - so it would fail this property
                // for a reason that has nothing to do with chunking. Bare arrays
                // stay allowed here, unlike rootSafeValueArbitrary: this property
                // never compares against JSON.parse, only against yajs's own
                // unchunked output, so it doesn't care that a root array gets
                // element-streamed rather than reconstructed - only that
                // chunking the input doesn't change that.
                jsonValueArbitrary.filter((value) => value !== ''),
                fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 50 }),
                async (value, chunkSizes) => {
                    const json = JSON.stringify(value);
                    const buffer = Buffer.from(json);

                    const whole = await runYajs(buffer);
                    const chunked = await runYajs(buffer, chunkSizes);

                    expect(chunked).to.deep.equal(whole);
                }),
            { numRuns: NUM_RUNS },
        ));

    // Tracked regression for the bug described above the jsonPrimitive
    // arbitrary: yajs's own number parser doesn't correctly round-trip
    // most non-integer JSON numbers. `it.fails` means this test passing
    // (i.e. the assertion inside failing, as it does today) is the
    // expected, green outcome; if a future fix to JsonSaxParser's number
    // parsing makes the assertion pass, `it.fails` itself will start
    // failing ("unexpectedly passed"), as a signal to promote this to a
    // normal `it` and drop the fc.integer()-only restriction above.
    it.fails('known bug: yajs mis-parses some non-integer JSON numbers (see jsonPrimitive comment)', async () => {
        const json = JSON.stringify(0.3);
        const actual = await runYajs(Buffer.from(json));
        expect(actual[0].value).to.equal(0.3);
    });

    // Tracked regression for the bug described above rootSafeValueArbitrary:
    // a document that is nothing but an empty string can't be parsed at
    // all. Same `it.fails` contract as the number-precision regression
    // above - this staying green means the bug is still present; if it
    // ever starts failing ("unexpectedly passed"), drop the `!== ''`
    // filters on rootSafeValueArbitrary and the chunking property's
    // arbitrary above, promote this to a normal `it`, and assert the
    // success case instead.
    it.fails('known bug: a document that is only an empty string ("") fails to parse', async () => {
        const actual = await runYajs(Buffer.from('""'));
        expect(actual).to.deep.equal([{ path: [], value: '' }]);
    });

    // Tracked regression for the bug described above rootSafeValueArbitrary:
    // an object key literally named "__proto__" doesn't become a data
    // property, unlike native JSON.parse. Same `it.fails` contract as the
    // two regressions above; if this starts failing ("unexpectedly
    // passed"), drop jsonKeyArbitrary's `!== '__proto__'` filter, promote
    // this to a normal `it`, and assert the success case instead.
    it.fails('known bug: an object key named "__proto__" is not reconstructed as an own property', async () => {
        // Written as a JSON string literal, not built via a `{ __proto__: ... }`
        // object literal - the latter is special-cased by JS itself to set the
        // new object's prototype rather than create an own property, which
        // would test the JS language's footgun instead of yajs's.
        const json = '{"__proto__":{"polluted":true}}';
        const actual = await runYajs(Buffer.from(json));
        expect(actual[0].value).to.deep.equal(JSON.parse(json));
    });

    // Tracked regression for bug 2 described above rootSafeValueArbitrary:
    // an object key that happens to share a name with an inherited
    // Object.prototype property (valueOf, toString, constructor,
    // hasOwnProperty, ...) is silently dropped, with no drop-keys `<...>`
    // syntax involved anywhere in the selector. Same `it.fails` contract as
    // the regressions above; if this starts failing ("unexpectedly
    // passed"), drop jsonKeyArbitrary's reserved-name filter, promote this
    // to a normal `it`, and assert the success case instead.
    it.fails('known bug: an object key that collides with an Object.prototype property name is silently dropped', async () => {
        const json = '{"valueOf":false}';
        const actual = await runYajs(Buffer.from(json));
        expect(actual[0].value).to.deep.equal(JSON.parse(json));
    });
});

/**
 * Pipes `buffer` through yajs('$') and collects every emitted { path, value }.
 *
 * When `chunkSizes` is provided, the buffer is split into pieces whose
 * lengths cycle through `chunkSizes` (so a short list of sizes still covers
 * an arbitrarily long buffer) and each piece is written as a separate
 * stream chunk, to exercise chunk-boundary handling. Omitted, the whole
 * buffer is written as a single chunk.
 */
function runYajs(buffer: Buffer, chunkSizes?: number[]): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const result: any[] = [];
        const stream = yajs('$');
        stream.
            on('data', (data: any) => result.push(data)).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));

        if (!chunkSizes || chunkSizes.length === 0) {
            stream.write(buffer);
        } else {
            let offset = 0;
            let sizeIdx = 0;
            while (offset < buffer.length) {
                const size = chunkSizes[sizeIdx % chunkSizes.length];
                stream.write(buffer.subarray(offset, offset + size));
                offset += size;
                sizeIdx += 1;
            }
        }
        stream.end();
    });
}
