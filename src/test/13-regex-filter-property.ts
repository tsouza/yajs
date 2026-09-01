import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

// Property-based coverage for GitHub issues #95 (project + drop-keys
// combined, gated on regex use) and #96 (the regex filter primitive
// itself), implemented together. See 01-parser.ts for parser/compiler-level
// unit tests, 02-path.ts for the combination gate's own parse-time
// acceptance/rejection tests, and 03-yajs.ts/10-fastpath.ts for end-to-end
// example-based coverage. These properties independently re-derive the
// expected answer from first principles (plain JS RegExp.test() over the
// actual key set, or a manual two-step "gate then drop" chain) rather than
// re-describing what the implementation does, so a change that keeps the
// implementation's own example-based tests green but is wrong relative to
// the spec would still be caught here.
const NUM_RUNS = 150;

// Keys restricted to a small, YAJS-grammar-safe alphanumeric alphabet - none
// of these characters need escaping for either the selector grammar itself
// (no '.', '!', space, '(', ')', '&', '|', '[', ']', '<', '>', '{', '}',
// '$', '*') or for being embedded as a literal inside one of
// patternArbitrary's own regex patterns below.
const keyArbitrary = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,7}$/);

// A curated set of regex patterns spanning: an exact anchored match, a
// substring match, a character class, a quantifier, an always-matching
// pattern (any single key satisfies '.'), and patterns designed to match
// NOTHING keyArbitrary can ever produce (letters only, so digit-class/
// digit-literal patterns are reliable "never matches" cases) - deliberately
// curated rather than fc.string()-generated regex source, since almost any
// random string isn't valid regex syntax at all (invalid-pattern handling
// is covered separately in 01-parser.ts/03-yajs.ts, not the concern here).
const patternArbitrary = fc.constantFrom(
    '^key\\d+$', 'key', '^foo$', 'o+', '[a-c]', '\\d', '.', '^$', 'k.y', '[0-9]+$', '^.{3}$',
);

function runSelector(selector: string, doc: object, options: object = {}): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const result: any[] = [];
        const stream = yajs(selector, options);
        stream.
            on('data', (d: any) => result.push(d)).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
        stream.write(Buffer.from(`${JSON.stringify(doc)}\n`));
        stream.end();
    });
}

describe('regex filter primitive - property-based (issue #96)', () => {

    it('matches iff at least one top-level key of the matched object satisfies the pattern ' +
        '(existential match, against random key sets and random patterns)', () =>
        fc.assert(fc.asyncProperty(
            fc.uniqueArray(keyArbitrary, { minLength: 0, maxLength: 6 }),
            patternArbitrary,
            async (keys, pattern) => {
                const obj = Object.fromEntries(keys.map((k) => [ k, 1 ]));
                const expected = keys.some((k) => new RegExp(pattern).test(k));

                const out = await runSelector(`$.a{/${pattern}/}`, { a: obj });

                expect(out.length > 0).to.equal(expected);
                if (expected) {
                    expect(out[0].value).to.deep.equal(obj);
                }
            },
        ), { numRuns: NUM_RUNS }));

    it('composes with a bare key via && exactly as the boolean expression predicts', () =>
        fc.assert(fc.asyncProperty(
            fc.uniqueArray(keyArbitrary, { minLength: 0, maxLength: 6 }),
            patternArbitrary,
            keyArbitrary,
            async (keys, pattern, bareKey) => {
                const obj = Object.fromEntries(keys.map((k) => [ k, 1 ]));
                const regexMatches = keys.some((k) => new RegExp(pattern).test(k));
                const bareMatches = keys.includes(bareKey);
                const expected = regexMatches && bareMatches;

                const out = await runSelector(`$.a{${bareKey} && /${pattern}/}`, { a: obj });

                expect(out.length > 0).to.equal(expected);
            },
        ), { numRuns: NUM_RUNS }));

    it('gates descent through a path filter (..[<filter>]key) the same way it gates project - against the ' +
        'actual chain of ancestor keys traversed to reach the target, not sibling keys along the way', () =>
        fc.assert(fc.asyncProperty(
            fc.uniqueArray(keyArbitrary, { minLength: 0, maxLength: 5 }),
            patternArbitrary,
            async (ancestorKeys, pattern) => {
                const expected = ancestorKeys.some((k) => new RegExp(pattern).test(k));

                // Build a straight linear nesting chain - ancestorKeys[0] at
                // the outermost level, "target" at the very bottom - so the
                // REAL ancestor-key set traversed to reach "target" is
                // exactly `ancestorKeys`, with no sibling keys anywhere to
                // confound it (see AbstractFilteredOperator/PathParent: the
                // filter walks the position operator's own parent chain,
                // which only ever contains genuine ancestors, never past
                // siblings at the same or a shallower depth).
                let doc: any = { target: 1 };
                for (let i = ancestorKeys.length - 1; i >= 0; i--) {
                    doc = { [ancestorKeys[i]]: doc };
                }

                const out = await runSelector(`$..[/${pattern}/]target`, doc);

                expect(out.length > 0).to.equal(expected);
                if (expected) {
                    expect(out[0].value).to.equal(1);
                }
            },
        ), { numRuns: NUM_RUNS }));
});

describe('project + drop-keys combined - differential vs manual two-step chaining (issue #95)', () => {

    it('matches manually chaining "apply project as a pure predicate, then apply drop-keys as a pure ' +
        'transform" as two independent steps, over random key sets/patterns/drop-key lists', () =>
        fc.assert(fc.asyncProperty(
            fc.uniqueArray(keyArbitrary, { minLength: 1, maxLength: 6 }),
            patternArbitrary,
            fc.uniqueArray(keyArbitrary, { minLength: 1, maxLength: 3 }),
            async (keys, pattern, dropKeys) => {
                const obj = Object.fromEntries(keys.map((k) => [ k, 1 ]));

                // Manual two-step reference implementation, kept completely
                // independent of ScriptFilterHelper/ObjectDispatcher: step 1
                // is a pure predicate over the FULL, undropped object; step
                // 2 is a pure transform deleting the listed keys - the same
                // "gate first, drop second" order #95 specifies, but
                // computed here with plain Object.entries()/filter(),
                // never sharing code with the implementation under test.
                const gatePasses = keys.some((k) => new RegExp(pattern).test(k));
                const expectedValue = gatePasses ?
                    Object.fromEntries(Object.entries(obj).filter(([ k ]) => !dropKeys.includes(k))) :
                    undefined;

                const selector = `$.a{/${pattern}/}<${dropKeys.join(' ')}>`;
                const out = await runSelector(selector, { a: obj });

                expect(out.length > 0).to.equal(gatePasses);
                if (gatePasses) {
                    expect(out[0].value).to.deep.equal(expectedValue);
                }
            },
        ), { numRuns: NUM_RUNS }));

    it('the opt-in NDJSON fast path (issue #78) agrees with the default engine on random regex-gated ' +
        'project+drop-keys combinations (both evaluation paths had their own gate/drop ordering fixed ' +
        'together with this feature - see FastPathEvaluator.ts)', () =>
        fc.assert(fc.asyncProperty(
            fc.uniqueArray(keyArbitrary, { minLength: 1, maxLength: 6 }),
            patternArbitrary,
            fc.uniqueArray(keyArbitrary, { minLength: 1, maxLength: 3 }),
            async (keys, pattern, dropKeys) => {
                const obj = Object.fromEntries(keys.map((k) => [ k, 1 ]));
                const selector = `$.a{/${pattern}/}<${dropKeys.join(' ')}>`;

                const [ real, fast ] = await Promise.all([
                    runSelector(selector, { a: obj }, { fastPath: false }),
                    runSelector(selector, { a: obj }, { fastPath: true }),
                ]);

                expect(fast.map((e) => e.value)).to.deep.equal(real.map((e) => e.value));
            },
        ), { numRuns: NUM_RUNS }));

    it('specifically covers the edge case where the regex gate matches ONLY on a key that drop-keys then ' +
        'removes - the gate already fired against the full object, so removal afterward is not a ' +
        'contradiction (random key sets, the matching key always also the sole drop-key)', () =>
        fc.assert(fc.asyncProperty(
            fc.uniqueArray(keyArbitrary, { minLength: 1, maxLength: 5 }),
            async (keys) => {
                const gateKey = keys[0];
                const obj = Object.fromEntries(keys.map((k) => [ k, 1 ]));
                const pattern = `^${gateKey}$`;

                const out = await runSelector(`$.a{/${pattern}/}<${gateKey}>`, { a: obj });

                expect(out).to.have.lengthOf(1);
                const expectedValue = Object.fromEntries(
                    Object.entries(obj).filter(([ k ]) => k !== gateKey));
                expect(out[0].value).to.deep.equal(expectedValue);
                expect(Object.prototype.hasOwnProperty.call(out[0].value, gateKey)).to.be.false;
            },
        ), { numRuns: NUM_RUNS }));
});

describe('pure-literal project+drop-keys combination stays rejected regardless of content (issue #52, must not regress)', () => {

    it('always throws "mutually exclusive" when neither side uses a regex primitive, over random key lists', () =>
        fc.assert(fc.property(
            fc.uniqueArray(keyArbitrary, { minLength: 1, maxLength: 4 }),
            fc.uniqueArray(keyArbitrary, { minLength: 1, maxLength: 4 }),
            (projectKeys, dropKeys) => {
                const selector = `$.a{${projectKeys.join(' ')}}<${dropKeys.join(' ')}>`;
                expect(() => yajs(selector)).to.throw(/mutually exclusive/);
            },
        ), { numRuns: 100 }));
});
