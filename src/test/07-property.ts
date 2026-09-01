import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

// A JSON-serializable value arbitrary, constrained relative to fc.jsonValue():
//
// - maxDepth is capped to keep the character-by-character SAX parser fast
//   across hundreds of runs (deep nesting is already exercised by the
//   dedicated example-based tests, not the concern of this property).
// - Numbers used to be restricted to fc.integer(), deliberately excluding
//   fc.float()/fc.double(), to route around a genuine precision bug in
//   yajs's own number parser (GitHub issue #49):
//   src/main/lib/utils/JsonSaxParser.ts used to accumulate the mantissa
//   digit by digit and, for a value with an exponent, finish with
//   `this.magnatude *= Math.pow(10, this.exponent)`. That is not how
//   correctly-rounded decimal-to-double parsing works, and it measurably
//   wasn't: a manual fuzz run of 20000 random doubles with exponents in
//   just [-10, 10] (nothing exotic - ordinary numbers like
//   -26491.059396597953 or 963160204.3665955) found yajs's parsed value
//   differed from the value JSON.stringify produced roughly 59% of the
//   time. fc.integer() sidestepped this because yajs's digit-by-digit
//   accumulation for a plain integer mantissa (no decimal point, no
//   exponent, so the lossy Math.pow step never ran) was exact for values in
//   JS's safe-integer range, which is exactly the range fc.integer()'s
//   default bounds live in.
//
//   Fixed: JsonSaxParser now accumulates the raw number literal as text
//   while tokenizing and hands the complete literal to `Number()` once the
//   token is known (the engine's own correctly-rounded string-to-double
//   conversion), instead of re-implementing that conversion by hand - see
//   the comment on flushPendingNumber() in JsonSaxParser.ts. fc.float() and
//   fc.double() are back below, and the dedicated regression test that used
//   to track this as a known bug (just below, in the describe block) is now
//   a normal passing assertion.
const jsonPrimitive = fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.float(),
    fc.double(),
    fc.string(),
);

// Object *keys* are unrestricted fc.string() - including names
// Object.prototype itself carries (constructor, toString, valueOf,
// hasOwnProperty, __proto__, ...). Those names used to be excluded here to
// work around two bugs in AbstractObjectBuilder.ts (see the dedicated
// regression tests below, which cover the fix for GitHub issue #12) where a
// plain `{}` was used as an unguarded hash map for both the object being
// assembled and the drop-keys lookup table; both now use
// `Object.create(null)` / `Object.defineProperty` so no such exclusion is
// needed any more.
const jsonKeyArbitrary = fc.string();

const jsonValueArbitrary = fc.letrec<{ value: unknown }>((tie) => ({
    value: fc.oneof(
        { depthIdentifier: 'json' },
        jsonPrimitive,
        fc.array(tie('value'), { maxLength: 8 }),
        fc.dictionary(jsonKeyArbitrary, tie('value'), { maxKeys: 8 }),
    ),
})).value;

// yajs streams the *immediate elements* of a matched array one at a time
// rather than buffering and emitting the whole array as a single value
// (confirmed both by manual probing here and by the existing
// '$.object4.object5' test in 03-yajs.ts, which asserts one emission per
// array element, not one emission of the array). That is presumably
// intentional - it is the whole point of a streaming parser that a huge
// top-level array need not be buffered in memory - but it means "$" does
// not reconstruct a document whose root value is itself a bare array as a
// *single* emission (and, consistently with the element-streaming behavior,
// an empty root array yields zero emissions rather than one emission of
// `[]`). See the dedicated 'root array streaming (issue #14)' property
// below, which broadens coverage to bare array roots specifically, asserting
// against their immediate elements rather than a single reconstructed value.
//
// Each element is still captured as one *whole* value, whatever it is - a
// scalar stays a scalar, an object is captured whole, and (since issue #14)
// an array is ALSO captured whole rather than being recursively flattened
// into its own leaf scalars. So an array nested inside an object, or nested
// two or more levels below a matched array, is unaffected by any of this -
// it is only ever collected as part of an ancestor element's whole value,
// never itself dispatched as a match - which is why this generator only
// needs to keep a BARE array from being the document's outermost shape.
//
// Fixed regression for GitHub issue #62: a document whose entire content
// is exactly the two bytes `""` (an empty string, and *nothing* else - no
// trailing newline, no wrapping container) used to fail to parse at all,
// with "Unexpected end of input stream", for both a single write and any
// chunking. Root cause, in src/main/lib/utils/JsonSaxParser.ts: reading
// `""` first lands the state machine in TDQSTR2 ("saw two quotes - is a
// third quote about to start a triple-quoted string, or is this an empty
// string followed by something else?"), which needs to peek at the *next*
// byte to decide. When that next byte is available in the buffer (a real
// document always has one - `,`, `}`, `]`, or whitespace follows any value
// that isn't the very last thing in the stream) the lookahead resolves
// cleanly and empty strings parse fine, as confirmed by `{"a":""}`,
// `["",""]`, and `""\n` all round-tripping correctly. But when `""` is the
// last two bytes ever written (true only when an empty string is the
// *entire* document, with no wrapping array/object to supply a trailing
// bracket), that lookahead byte never arrived, and `finish()` used to have
// no case for the TDQSTR2 state at all, so it fell straight through to the
// generic "Unexpected end of input stream" error. Fixed by
// flushPendingTdqLookahead() in JsonSaxParser.ts, called from finish():
// once the stream has genuinely ended, no third quote can possibly still
// be coming, so TDQSTR2 unambiguously resolves to a complete, empty,
// ordinary string. See the dedicated regression test below.
//
// GitHub issue #12 (fixed): object keys colliding with an Object.prototype
// property name (constructor, toString, valueOf, hasOwnProperty,
// __proto__, ...) used to be silently dropped or, for `__proto__`
// specifically, misinterpreted as reassigning the built object's actual
// prototype - both were instances of the same root mistake (treating a
// plain `{}` as a hash map without guarding against its inherited
// properties) in AbstractObjectBuilder.ts's ObjectNode.handle and dropKeys
// lookup table. Both now use `Object.create(null)` / `Object.defineProperty`
// instead of a plain `{}` and bare `[key] =` assignment, so
// jsonKeyArbitrary above no longer needs to exclude these names - the
// property below exercises them like any other key. See the dedicated
// regression tests further down for the specific, previously-broken cases.
const rootSafeValueArbitrary = fc.oneof(
    jsonPrimitive,
    fc.dictionary(jsonKeyArbitrary, jsonValueArbitrary, { maxKeys: 8 }),
);

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

    // Broadened coverage for issue #14, now that a bare array root no
    // longer recursively flattens to leaf scalars: unlike
    // rootSafeValueArbitrary above, a bare array root is exactly what this
    // property wants to generate, since it is specifically checking the
    // one-level-streaming behavior "$" applies to a matched array - each
    // element captured as one whole value (deep-equal to JSON.parse's own
    // reconstruction of that element, however deeply nested it is
    // internally) and emitted in order, rather than one emission of the
    // whole array or a flattened run of leaf scalars.
    it('streams a root array\'s immediate elements as whole values, in order (issue #14)', () =>
        fc.assert(
            fc.asyncProperty(fc.array(jsonValueArbitrary, { maxLength: 8 }), async (value) => {
                const json = JSON.stringify(value);
                const expectedElements = JSON.parse(json);

                const actual = await runYajs(Buffer.from(json));

                expect(actual.map((e) => e.value)).to.deep.equal(expectedElements);
                actual.forEach((e) => expect(e.path).to.be.empty);
            }),
            { numRuns: NUM_RUNS },
        ));

    it('produces the same result regardless of how the input is chunked', () =>
        fc.assert(
            fc.asyncProperty(
                // Bare arrays stay allowed here, unlike rootSafeValueArbitrary:
                // this property never compares against JSON.parse, only against
                // yajs's own unchunked output, so it doesn't care that a root
                // array gets element-streamed rather than reconstructed - only
                // that chunking the input doesn't change that. (The `!== ''`
                // filter this used to need alongside rootSafeValueArbitrary,
                // for the now-fixed issue #62 empty-string-at-EOF gap, is gone
                // - see the comment above rootSafeValueArbitrary.)
                jsonValueArbitrary,
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

    // Fixed regression for GitHub issue #49 (see the jsonPrimitive comment
    // above): yajs's number parser used to mis-parse most non-integer JSON
    // numbers via lossy digit-by-digit mantissa accumulation. Promoted from
    // the `it.fails` this used to be once JsonSaxParser's number tokenizer
    // was switched to a single `Number(literal)` conversion.
    it('correctly round-trips a non-integer JSON number (see jsonPrimitive comment)', async () => {
        const json = JSON.stringify(0.3);
        const actual = await runYajs(Buffer.from(json));
        expect(actual[0].value).to.equal(0.3);
    });

    // Fixed regression for GitHub issue #62 (see the comment above
    // rootSafeValueArbitrary): a document that is nothing but an empty
    // string used to fail to parse entirely (the TDQSTR2 end-of-stream
    // lookahead gap). Promoted from the `it.fails` this used to be once
    // finish() gained a case for TDQSTR2 (flushPendingTdqLookahead() in
    // JsonSaxParser.ts).
    it('correctly parses a document that is only an empty string ("")', async () => {
        const actual = await runYajs(Buffer.from('""'));
        expect(actual).to.deep.equal([{ path: [], value: '' }]);
    });

    // Regression property for GitHub issue #76 / PR #81: StreamContext now
    // reuses a single StreamPosition across successive NDJSON records
    // (StreamPosition.reinitialize()) instead of allocating a fresh one per
    // record. Cross-checks a multi-record NDJSON stream's output against
    // each record run through its own, fully isolated yajs() call - the
    // strongest possible "nothing leaks between records" property,
    // independent of any hand-computed expectation: whatever internal state
    // (position bookkeeping, ancestor-key cache, path-segment cache)
    // survives the reused StreamPosition between records must have
    // literally zero observable effect, for ANY selector/record
    // combination, or this fails. Complements the specific hand-picked
    // adversarial cases in 03-yajs.ts's "StreamPosition reuse does not leak
    // state" describe block with broad randomized coverage.
    it('produces the same result for a multi-record NDJSON stream as running each record through its own isolated yajs() call (issue #76)', () =>
        fc.assert(
            fc.asyncProperty(
                fc.array(rootSafeValueArbitrary, { minLength: 1, maxLength: 6 }),
                fc.constantFrom('$', '$.*', '$..a', '$..*', '$.a..a'),
                fc.boolean(),
                async (records, selector, includeIdx) => {
                    const jsons = records.map((r) => JSON.stringify(r));

                    const isolated: any[] = [];
                    for (const json of jsons) {
                        isolated.push(...await runYajsSelector(selector, Buffer.from(json), includeIdx));
                    }

                    const combined = await runYajsSelector(selector, Buffer.from(jsons.join('\n')), includeIdx);

                    expect(combined).to.deep.equal(isolated);
                }),
            { numRuns: NUM_RUNS },
        ), 30000);

    // Fixed regression for GitHub issue #12: an object key literally named
    // "__proto__" must become a real own data property, like native
    // JSON.parse, rather than reassigning the built object's actual
    // prototype. Also confirms the fix doesn't just move where the value is
    // dropped - the object's real [[Prototype]] must still be
    // Object.prototype after parsing.
    it('reconstructs an object key named "__proto__" as an own data property, without touching the real prototype chain', async () => {
        // Written as a JSON string literal, not built via a `{ __proto__: ... }`
        // object literal - the latter is special-cased by JS itself to set the
        // new object's prototype rather than create an own property, which
        // would test the JS language's footgun instead of yajs's.
        const json = '{"__proto__":{"polluted":true}}';
        const actual = await runYajs(Buffer.from(json));
        const value = actual[0].value;
        expect(value).to.deep.equal(JSON.parse(json));
        expect(Object.getPrototypeOf(value)).to.equal(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).to.be.true;
    });

    // Fixed regression for GitHub issue #12: an object key that happens to
    // share a name with an inherited Object.prototype property (valueOf,
    // toString, constructor, hasOwnProperty, ...) must not be silently
    // dropped, even with no drop-keys `<...>` syntax involved anywhere in
    // the selector.
    it('reconstructs an object key that collides with an Object.prototype property name', async () => {
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

/**
 * Same as runYajs() above, but against an arbitrary selector/
 * pathIncludeArrayIndex, and resolving with just the { path, value } pairs
 * (dropping the isTrusted/other stream-internal fields data events may
 * carry) so an isolated single-record run and a same-selector slice of a
 * multi-record combined run compare equal by plain deep-equality.
 */
function runYajsSelector(selector: string, buffer: Buffer, pathIncludeArrayIndex: boolean): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const result: any[] = [];
        const stream = yajs(selector, { pathIncludeArrayIndex });
        stream.
            on('data', (data: any) => result.push({ path: data.path, value: data.value })).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
        stream.write(buffer);
        stream.end();
    });
}
