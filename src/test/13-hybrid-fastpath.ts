import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

// Permanent differential guard for the SKIP/PARSE/DESCEND span-parsing
// hybrid fast path (`fastPath: 'hybrid'`, issues #79/#87). Promotes draft
// PR #90's throwaway check-correctness.js-style differential coverage into
// a real, permanent suite, in the same spirit as 10-fastpath.ts's own
// header comment for the 'line' fast path this one sits alongside.
//
// Unlike 10-fastpath.ts's GenericWalker, hybrid mode implements issue #89's
// innermost-only default NATIVELY (see HybridSpanEvaluator.ts's
// resolveMatch()) - so, for the selector shapes it actually compiles (see
// HybridSpanEvaluator.ts's own scope note), it is held to match the REAL
// engine exactly, including self-nesting cases, with NO documented
// divergence list the way 10-fastpath.ts needs one. The one place this
// file's own CASES need care is a selector shape hybrid mode itself
// doesn't compile (falls back to 'line' mode wholesale - see
// HybridFastPath.ts) - those inherit 'line' mode's own already-documented
// behavior (including ITS GenericWalker divergence), asserted against
// 'line' mode's own output, not the real engine's - see the "unsupported
// selector shapes delegate to line mode" describe block below.
describe('SKIP/PARSE/DESCEND span-parsing hybrid fast path (opt-in, issues #79/#87)', () => {

    describe('differential: hybrid output matches the default engine exactly', () => {
        const CASES: Array<[string, string, string, object?]> = [
            ['bare terminal descendant key', '$..plugins',
                '{"_source":{"a":{"plugins":{"x":1}}},"other":{"plugins":[1,2,3]}}\n'],
            ['descendant + one suffix key (dataset-4 shape)', '$..array.deep1',
                '{"array":[{"deep1":"v1","junk":2},{"deep1":"v2"}]}\n'],
            ['descendant + multi-key suffix chain', '$..a.b.c',
                '{"x":{"a":{"b":{"c":1,"junk":2}}},"y":{"a":{"b":{}}}}\n'],
            ['suffix chain through array transparency', '$..a.b',
                '{"x":{"a":[{"b":1},{"b":2},{"c":3}]}}\n'],
            ['matched array fans out one event per element (issue #14, verified by #79 spike)', '$..plugins',
                '{"plugins":[1,2,3]}\n{"plugins":[]}\n{"plugins":[[1,2],{"n":1}]}\n'],
            ['matched scalar', '$..x', '{"a":{"x":1},"b":{"x":"s"},"c":{"x":null}}\n'],
            ['no match anywhere', '$..plugins', '{"nothing":"here","nested":{"also":"nothing"}}\n'],
            ['project on the descendant match', '$..plugins{a}', '{"plugins":{"a":1,"b":2}}\n'],
            ['project on the suffix chain terminus', '$..a.b{x}', '{"a":{"b":{"x":1,"y":2}}}\n'],
            ['drop keys on the descendant match', '$..plugins<b>', '{"plugins":{"a":1,"b":2}}\n'],
            ['drop keys on the suffix chain terminus', '$..a.b<y>', '{"a":{"b":{"x":1,"y":2}}}\n'],
            ['target key never occurs', '$..zzz', '{"a":1,"b":{"c":2}}\n'],
            ['target key occurs only as a non-key string value (must not false-positive)', '$..plugins',
                '{"note":"plugins are great","other":1}\n'],
            ['escaped characters inside sibling string values near the target key', '$..plugins',
                '{"noise":"a \\"quoted\\" \\\\backslash\\\\ string","plugins":1}\n'],
            ['object root with many non-matching siblings (SKIP-heavy)', '$..needle',
                `{${Array.from({ length: 30 }, (_, i) => `"f${i}":${i}`).join(',')},"needle":42}\n`],
            ['top-level array of records (dataset-3 shape)', '$..plugins',
                '[{"plugins":1},{"other":2},{"plugins":3}]\n'],
            ['multiple NDJSON records', '$..plugins', '{"plugins":1}\n{"other":1}\n{"plugins":2}\n'],
            ['bare scalar top-level records interspersed', '$..a', '42\n{"a":1}\n"str"\n{"a":2}\nnull\n'],
            ['__proto__ own-key handling (issue #12/#66)', '$..a', '{"x":{"a":{"__proto__":{"y":1}}}}\n'],
        ];

        CASES.forEach(([name, selector, input, options]) => {
            it(name, () => Promise.all([
                run(selector, input, { ...options, fastPath: false }),
                run(selector, input, { ...options, fastPath: 'hybrid' }),
            ]).then(([real, hybrid]) => {
                expect(hybrid.out, 'matches').to.deep.equal(real.out);
                expect(hybrid.errors.length > 0, 'error outcome').to.equal(real.errors.length > 0);
            }));
        });
    });

    // Issue #89: hybrid mode implements innermost-only NATIVELY (unlike
    // 'line' mode's GenericWalker - see 10-fastpath.ts's own pinned
    // divergence test) - these all assert exact equality with the real
    // engine, not a documented-different-behavior pair.
    describe('issue #89 interaction: self-nesting descendant matches (innermost-only, matches the real engine natively)', () => {
        const CASES: Array<[string, string, string]> = [
            ['two levels of self-nesting', '$..a', '{"a":{"b":{"a":{"c":1}}}}\n'],
            ['many levels of self-nesting', '$..a', '{"a":{"a":{"a":{"a":{"a":1}}}}}\n'],
            ['self-nesting plus a disjoint sibling', '$..a', '{"p":{"a":{"a":1}},"q":{"a":2}}\n'],
            ['self-nesting with two disjoint inner occurrences (not nested in each other)', '$..a',
                '{"x":{"a":{"b":[{"a":1},{"a":2}]}}}\n'],
            ['self-nesting through the suffix chain', '$..a.b', '{"a":{"b":{"a":{"b":2}}}}\n'],
            ['self-nesting through an array', '$..a', '{"a":{"items":[{"a":1},{"x":{"a":2}}]}}\n'],
            ['no self-nesting at all (control - must be a no-op)', '$..a', '{"x":{"a":1},"y":{"a":2}}\n'],
        ];
        CASES.forEach(([name, selector, input]) => {
            it(name, () => Promise.all([
                run(selector, input, { fastPath: false }),
                run(selector, input, { fastPath: 'hybrid' }),
            ]).then(([real, hybrid]) => {
                expect(hybrid.out).to.deep.equal(real.out);
            }));
        });
    });

    // compileHybridPlan() only handles `$..k1.k2...kn` (see
    // HybridSpanEvaluator.ts's own scope note) - every other shape falls
    // back to constructing a full NdjsonFastPath('line' mode) instance
    // internally and delegating write()/end() to it wholesale (see
    // HybridFastPath.ts). These assert hybrid's output is IDENTICAL to
    // 'line' mode's own output for the same input (not necessarily the
    // real engine's, for shapes where 'line' mode itself has a documented
    // divergence - see 10-fastpath.ts) - proving the delegation is a
    // faithful, complete pass-through.
    describe('unsupported selector shapes delegate to \'line\' mode wholesale', () => {
        const CASES: Array<[string, string, string, object?]> = [
            ['plain definite chain (no descendant at all)', '$.field2.nested',
                '{"field2":{"nested":1},"other":2}\n'],
            ['wildcard', '$.a.*', '{"a":{"x":1,"y":2}}\n'],
            ['descendant with an ancestor filter', '$..[a]b', '{"a":1,"nested":{"b":2}}\n'],
            ['a definite prefix before the descendant', '$.x..y', '{"x":{"a":{"y":1}},"z":{"y":2}}\n'],
            ['two descendant operators', '$..a..b', '{"a":{"c":{"b":1}}}\n'],
            ['self-nesting through an unsupported (prefixed) shape - inherits line mode\'s own divergence, not a new bug',
                '$.x..a', '{"x":{"a":{"a":1}}}\n'],
        ];
        CASES.forEach(([name, selector, input, options]) => {
            it(name, () => Promise.all([
                run(selector, input, { ...options, fastPath: 'line' }),
                run(selector, input, { ...options, fastPath: 'hybrid' }),
            ]).then(([line, hybrid]) => {
                expect(hybrid.out, 'matches line mode exactly').to.deep.equal(line.out);
            }));

            it(`${name} - pathIncludeArrayIndex also delegates`, () => Promise.all([
                run(selector, input, { ...options, fastPath: 'line', pathIncludeArrayIndex: true }),
                run(selector, input, { ...options, fastPath: 'hybrid', pathIncludeArrayIndex: true }),
            ]).then(([line, hybrid]) => {
                expect(hybrid.out).to.deep.equal(line.out);
            }));
        });

        it('pathIncludeArrayIndex alone (otherwise hybrid-shaped selector) also delegates to line mode', () =>
            Promise.all([
                run('$..plugins', '{"a":{"plugins":[1,2]}}\n', { fastPath: 'line', pathIncludeArrayIndex: true }),
                run('$..plugins', '{"a":{"plugins":[1,2]}}\n', { fastPath: 'hybrid', pathIncludeArrayIndex: true }),
            ]).then(([line, hybrid]) => {
                expect(hybrid.out).to.deep.equal(line.out);
            }));
    });

    describe('fallback to the real engine (bytes hybrid\'s own scanner can\'t handle inline)', () => {
        it('a malformed record reports exactly one error and resyncs, identical output to the default engine', () =>
            Promise.all([
                run('$..a', '{"a":1}\n{oops}\n{"a":3}\n', { fastPath: false }),
                run('$..a', '{"a":1}\n{oops}\n{"a":3}\n', { fastPath: 'hybrid' }),
            ]).then(([real, hybrid]) => {
                expect(real.errors).to.have.lengthOf(1);
                expect(hybrid.errors).to.have.lengthOf(1);
                expect(hybrid.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([{ path: ['a'], value: 1 }, { path: ['a'], value: 3 }]);
            }));

        it('fast-path-eligible records resume normally after a malformed record (no permanent fallback)', () =>
            run('$..a', '{"a":1}\n{oops}\n{"a":3}\n{"a":4}\n', { fastPath: 'hybrid' }).then((r) => {
                expect(r.out.map((e: any) => e.value)).to.deep.equal([1, 3, 4]);
                expect(r.errors).to.have.lengthOf(1);
            }));

        it('the """ triple-quote extension - JSON.parse can never accept it - still round-trips via fallback', () =>
            Promise.all([
                run('$..q', '{"q":"""He said "hi" to me"""}\n{"q":"plain"}\n', { fastPath: false }),
                run('$..q', '{"q":"""He said "hi" to me"""}\n{"q":"plain"}\n', { fastPath: 'hybrid' }),
            ]).then(([real, hybrid]) => {
                expect(hybrid.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([
                    { path: ['q'], value: 'He said "hi" to me' },
                    { path: ['q'], value: 'plain' },
                ]);
            }));

        it('a record with an oversized matched span (hybridMaxSpanBytes) still produces correct output, no spurious error', () =>
            Promise.all([
                run('$..a', `{"a":"${'x'.repeat(200)}"}\n{"a":"small"}\n`, { fastPath: false }),
                run('$..a', `{"a":"${'x'.repeat(200)}"}\n{"a":"small"}\n`, { fastPath: 'hybrid', hybridMaxSpanBytes: 50 }),
            ]).then(([real, hybrid]) => {
                expect(hybrid.out).to.deep.equal(real.out);
                expect(hybrid.errors).to.have.lengthOf(0);
            }));

        it('records under hybridMaxSpanBytes still take the fast path (control - no fallback triggered)', () =>
            run('$..a', '{"a":1}\n', { fastPath: 'hybrid', hybridMaxSpanBytes: 40 }).then((r) => {
                expect(r.out).to.deep.equal([{ path: ['a'], value: 1 }]);
                expect(r.errors).to.have.lengthOf(0);
            }));

        it('an earlier, valid match in the same record is not double-emitted when a LATER match in that record trips hybridMaxSpanBytes', () =>
            Promise.all([
                run('$..a', `{"small":{"a":1},"big":{"a":"${'x'.repeat(200)}"}}\n{"a":2}\n`, { fastPath: false }),
                run('$..a', `{"small":{"a":1},"big":{"a":"${'x'.repeat(200)}"}}\n{"a":2}\n`, { fastPath: 'hybrid', hybridMaxSpanBytes: 50 }),
            ]).then(([real, hybrid]) => {
                expect(hybrid.out).to.deep.equal(real.out);
                expect(hybrid.out).to.deep.equal([
                    { path: ['small', 'a'], value: 1 },
                    { path: ['big', 'a'], value: 'x'.repeat(200) },
                    { path: ['a'], value: 2 },
                ]);
            }));
    });

    describe('chunk-boundary safety', () => {
        it('produces identical events no matter how the input is split across write() calls', async () => {
            const input = Buffer.from('{"a":{"plugins":1}}\n{oops}\n{"other":{"plugins":{"b":2}}}\n');
            const baseline = await run('$..plugins', input, { fastPath: 'hybrid' });
            expect(baseline.out.length).to.be.greaterThan(0);
            for (let i = 1; i < input.length; i++) {
                const actual = await runChunks('$..plugins', [input.subarray(0, i), input.subarray(i)], { fastPath: 'hybrid' });
                expect(actual.out, `split at byte offset ${i}/${input.length}`).to.deep.equal(baseline.out);
                expect(actual.errors.length, `split at byte offset ${i}/${input.length}`).to.equal(baseline.errors.length);
            }
        });

        it('produces identical events with one byte per write() call, including self-nesting', async () => {
            const input = Buffer.from('{"a":{"a":{"a":1}},"b":{"a":2}}\n');
            const baseline = await run('$..a', input, { fastPath: 'hybrid' });
            const oneByteAtATime = Array.from(input, (b) => Buffer.from([b]));
            const actual = await runChunks('$..a', oneByteAtATime, { fastPath: 'hybrid' });
            expect(actual.out).to.deep.equal(baseline.out);
        });

        it('a whale-record shape (one huge top-level object with many modest matches) still streams correctly at every split point', async () => {
            const fields: string[] = [];
            for (let i = 0; i < 40; i++) {
                fields.push(`"field${i}":{"deep":{"array":[{"deep1":"v${i}a"},{"deep1":"v${i}b"}]}}`);
            }
            const input = Buffer.from(`{${fields.join(',')}}\n`);
            const baseline = await run('$..array.deep1', input, { fastPath: 'hybrid' });
            expect(baseline.out.length).to.equal(80);
            for (const chunkSize of [1, 5, 13, 64, 512]) {
                const chunks: Buffer[] = [];
                for (let i = 0; i < input.length; i += chunkSize) { chunks.push(input.subarray(i, Math.min(i + chunkSize, input.length))); }
                const actual = await runChunks('$..array.deep1', chunks, { fastPath: 'hybrid' });
                expect(actual.out, `chunkSize=${chunkSize}`).to.deep.equal(baseline.out);
            }
        });
    });

    describe('empty/whitespace-only input', () => {
        it('reports the same "no data" error as the default engine for empty input', () =>
            Promise.all([run('$..a', '', { fastPath: false }), run('$..a', '', { fastPath: 'hybrid' })]).
                then(([real, hybrid]) => {
                    expect(real.errors).to.have.lengthOf(1);
                    expect(hybrid.errors).to.have.lengthOf(1);
                    expect(hybrid.errors[0].message).to.equal(real.errors[0].message);
                }));

        it('a trailing record with no final newline is still processed', () =>
            Promise.all([
                run('$..a', '{"a":1}\n{"a":2}', { fastPath: false }),
                run('$..a', '{"a":1}\n{"a":2}', { fastPath: 'hybrid' }),
            ]).then(([real, hybrid]) => {
                expect(hybrid.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([{ path: ['a'], value: 1 }, { path: ['a'], value: 2 }]);
            }));

        it('a trailing bare top-level scalar with no final delimiter still falls back correctly (see SpanBuffer.ts scanValueEnd)', () =>
            Promise.all([
                run('$..a', '{"a":1}\n42', { fastPath: false }),
                run('$..a', '{"a":1}\n42', { fastPath: 'hybrid' }),
            ]).then(([real, hybrid]) => {
                expect(hybrid.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([{ path: ['a'], value: 1 }]);
                expect(hybrid.errors.length).to.equal(real.errors.length);
            }));
    });

    // Randomized differential coverage (promotes draft PR #90's
    // check-correctness.js prototype into a permanent, non-gamed property):
    // for many generated documents and generated `$..k1.k2...kn` selectors
    // (hybrid's own supported shape - see HybridSpanEvaluator.ts), hybrid
    // mode's output through the real public yajs() API must exactly equal
    // the default engine's - including issue #89's self-nesting cases, which
    // the small key alphabet here (reused from 11-property-selector-
    // oracle.ts's own KEY_CHARS rationale) makes a frequent, not
    // hypothetical, occurrence.
    describe('randomized differential property (thousands of cases)', () => {
        const KEY_CHARS = 'abc';
        const keyArb = fc.array(fc.constantFrom(...KEY_CHARS.split('')), { minLength: 1, maxLength: 2 }).
            map((cs) => cs.join(''));
        const selectorKeysArb = fc.array(keyArb, { minLength: 1, maxLength: 3 });
        const jsonValueArb = fc.letrec<{ value: unknown }>((tie) => ({
            value: fc.oneof(
                { depthIdentifier: 'json' },
                fc.oneof(fc.constant(null), fc.boolean(), fc.integer({ min: -1000, max: 1000 })),
                fc.array(tie('value'), { maxLength: 3 }),
                fc.dictionary(keyArb, tie('value'), { maxKeys: 3 }),
            ),
        })).value;
        const rootArb = fc.dictionary(keyArb, jsonValueArb, { maxKeys: 3 });

        it('hybrid output equals the default engine\'s for generated $..k1.k2...kn selectors and documents', () =>
            fc.assert(
                fc.asyncProperty(selectorKeysArb, rootArb, async (keys, doc) => {
                    const selector = `$..${keys.join('.')}`;
                    const json = JSON.stringify(doc);
                    const [real, hybrid] = await Promise.all([
                        run(selector, json, { fastPath: false }),
                        run(selector, json, { fastPath: 'hybrid' }),
                    ]);
                    const norm = (r: RunResult) => JSON.stringify(r.out.map((e: any) => [e.path, e.value]).
                        sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
                    expect(norm(hybrid), `selector=${selector} doc=${json}`).to.equal(norm(real));
                    expect(hybrid.errors.length).to.equal(real.errors.length);
                }),
                { numRuns: 5000 },
            ), 120000);
    });
});

interface RunResult { out: any[]; errors: Error[]; }

function run(path: string, input: string | Buffer, options: object): Promise<RunResult> {
    return runChunks(path, [input], options);
}

function runChunks(path: string, chunks: Array<string | Buffer>, options: object): Promise<RunResult> {
    return new Promise<RunResult>((resolve) => {
        const out: any[] = [];
        const errors: Error[] = [];
        const stream = yajs(path, options);
        stream.
            on('data', (data: any) => out.push(data)).
            on('error', (err: Error) => errors.push(err)).
            on('end', () => resolve({ out, errors }));
        chunks.forEach((chunk) => stream.write(chunk));
        stream.end();
    });
}
