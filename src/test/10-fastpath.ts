
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

// Permanent differential guard for the opt-in NDJSON fast path (issue #78):
// "every future selector feature must pass engine-vs-walker equivalence"
// is non-negotiable per that issue - this file is the curated, fast-CI
// subset of the ~40,000-case differential sweep the feature was validated
// against during development (see fastpath/diff.js on the
// draft-perf-ndjson-fastpath-2026-09 branch for the full sweep - not
// promoted here since it takes minutes to run and this file's curated set
// already exercises every selector/input shape category it covers).
//
// Every test in the "differential" describe block below runs the SAME
// selector/input through both engines (fastPath: false - the default,
// battle-tested SAX engine - and fastPath: true) via the real public
// yajs() API and asserts they produce identical {path, value} sequences
// and identical error/no-error outcomes, except where a divergence is
// explicitly documented and expected (see "documented semantic
// divergences" below) - those assert the *specific*, documented different
// behavior instead, so a regression that accidentally makes them match
// (or diverge differently) is still caught.
describe('NDJSON fast path (opt-in, issue #78)', () => {

    describe('default behavior unchanged', () => {
        it('defaults fastPath to false - omitting the option behaves exactly as before', () =>
            run('$.a', '{"a":1}\n', undefined).then((r) => {
                expect(r.out).to.deep.equal([{ path: ['a'], value: 1 }]);
            }));
    });

    describe('differential: fastPath output matches the default engine', () => {
        // One representative selector/input pair per feature-matrix
        // category from issue #78's coverage list.
        const CASES: Array<[string, string, string, object?]> = [
            ['definite key chain (the common/optimized case)', '$.field2.nested',
                '{"field1":1,"field2":{"nested":"v1","other":2}}\n{"field2":{"nested":"v2"}}\n'],
            ['chain through array transparency', '$.a.b',
                '{"a":[{"b":1},{"b":2},{"c":3}]}\n'],
            ['chain into nested array elements (issue #14 element streaming)', '$.a',
                '{"a":[1,[2,3],{"b":4}]}\n'],
            ['wildcard (falls back to GenericWalker)', '$.a.*',
                '{"a":{"x":1,"y":2}}\n{"a":{"z":3}}\n'],
            ['descendant', '$..b', '{"a":{"b":1,"c":{"b":2}},"b":3}\n'],
            ['descendant with ancestor filter', '$..[a]b',
                '{"a":1,"nested":{"b":2}}\n{"nested":{"b":3}}\n'],
            ['negated ancestor filter', '$..[!a]b',
                '{"a":1,"nested":{"b":2}}\n{"other":1,"nested":{"b":3}}\n'],
            ['boolean filter combinator', '$..[key1 || key2]child',
                '{"key1":1,"child":"v1"}\n{"key3":1,"child":"v2"}\n'],
            ['project', '$.a{x}', '{"a":{"x":1,"y":2}}\n{"a":{"y":3}}\n'],
            ['project with boolean expression', '$.a{!x}',
                '{"a":{"x":1}}\n{"a":{"y":2}}\n'],
            ['drop keys at chain terminus', '$<b>', '{"a":1,"b":2,"c":3}\n'],
            // NOT '$..a<b>' against a self-nesting "a" here (issue #38's
            // original repro for this row) - since issue #89, that shape is
            // one of the two documented semantic divergences below instead
            // (GenericWalker doesn't implement innermost-only), so it can no
            // longer sit in this "must match" list. A NON-self-nesting drop-
            // keys-through-descendant case still belongs here, to keep this
            // row's original coverage (drop keys applied to a descendant
            // match) for the case that ISN'T affected by #89.
            ['drop keys through a descendant match, no self-nesting (issue #38)', '$..a<b>',
                '{"x":{"a":{"b":1,"c":2}}}\n'],
            ['root selector, whole-document match', '$', '{"a":1,"b":[1,2]}\n'],
            ['root array (comma-NDJSON framing)', '$', '[1,2,3]\n'],
            ['bare scalar records at the root', '$', '42\n"str"\ntrue\nfalse\nnull\n'],
            ['__proto__ own-key handling (issue #12/#66)', '$.a',
                '{"a":{"__proto__":{"x":1}}}\n'],
            ['project rejects an inherited (non-own) Object.prototype name (issue #66)', '$.a{toString}',
                '{"a":{"b":1}}\n{"a":{"toString":1}}\n'],
            // Issues #95/#96: regex filter primitive, standalone and in the
            // regex-gated project+drop-keys combination - both GenericWalker
            // (via ScriptFilterHelper's keySetProvider) and ChainEvaluator
            // (project/drop-keys at chain terminus) need to agree with the
            // real engine on these.
            ['regex filter primitive in project', '$.a{/^key\\d+$/}',
                '{"a":{"key1":1,"other":2}}\n{"a":{"foo":1}}\n'],
            ['regex filter primitive in a path filter', '$..[/^key\\d+$/]target',
                '{"key1":{"target":"v1"}}\n{"safe":{"target":"v2"}}\n'],
            ['regex-gated project+drop-keys combination', '$.a{/^key\\d+$/}<other>',
                '{"a":{"key1":1,"other":2}}\n{"a":{"foo":1,"other":2}}\n'],
            ['regex-gated combination where the gate matches on a key drop-keys then removes', '$.a{/^key1$/}<key1>',
                '{"a":{"key1":1,"other":2}}\n'],
        ];

        CASES.forEach(([name, selector, input, options]) => {
            it(name, () => Promise.all([
                run(selector, input, { ...options, fastPath: false }),
                run(selector, input, { ...options, fastPath: true }),
            ]).then(([real, fast]) => {
                expect(fast.out, 'matches').to.deep.equal(real.out);
                expect(fast.errors.length > 0, 'error outcome').to.equal(real.errors.length > 0);
            }));
        });

        it('pathIncludeArrayIndex produces identical paths through the chain evaluator', () =>
            Promise.all([
                run('$.a.b', '{"a":[{"b":1},{"b":2}]}\n', { fastPath: false, pathIncludeArrayIndex: true }),
                run('$.a.b', '{"a":[{"b":1},{"b":2}]}\n', { fastPath: true, pathIncludeArrayIndex: true }),
            ]).then(([real, fast]) => {
                expect(fast.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([
                    { path: ['a', 0, 'b'], value: 1 },
                    { path: ['a', 1, 'b'], value: 2 },
                ]);
            }));

        it('pathIncludeArrayIndex produces identical paths through the generic walker', () =>
            Promise.all([
                run('$..b', '{"a":[{"b":1},{"b":2}]}\n', { fastPath: false, pathIncludeArrayIndex: true }),
                run('$..b', '{"a":[{"b":1},{"b":2}]}\n', { fastPath: true, pathIncludeArrayIndex: true }),
            ]).then(([real, fast]) => {
                expect(fast.out).to.deep.equal(real.out);
            }));
    });

    // The two divergences issue #78 documents as accepted, inherent to
    // using JSON.parse instead of the byte-by-byte SAX tokenizer - see
    // YAJSOptions.fastPath's doc comment in yajs.ts and the README - plus
    // one more added by issue #89 (GenericWalker not implementing
    // innermost-only self-nesting semantics - see its own test below).
    // These assert the SPECIFIC documented-different behavior (not merely
    // "the two engines disagree"), so a future change that alters exactly
    // how they disagree is caught too.
    describe('documented semantic divergences (accepted, not bugs)', () => {
        it('duplicate object keys: the default engine emits one match per occurrence; fastPath keeps only the last (JSON.parse semantics)', () =>
            Promise.all([
                run('$.a', '{"a":1,"a":2}\n', { fastPath: false }),
                run('$.a', '{"a":1,"a":2}\n', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(real.out).to.deep.equal([{ path: ['a'], value: 1 }, { path: ['a'], value: 2 }]);
                expect(fast.out).to.deep.equal([{ path: ['a'], value: 2 }]);
            }));

        it('integer-like key emission order: fastPath follows JS own-property enumeration order (integer-like keys first, ascending) instead of raw text order', () =>
            Promise.all([
                run('$.*', '{"b":1,"2":2,"a":3}\n', { fastPath: false }),
                run('$.*', '{"b":1,"2":2,"a":3}\n', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(real.out).to.deep.equal([
                    { path: ['b'], value: 1 }, { path: ['2'], value: 2 }, { path: ['a'], value: 3 },
                ]);
                expect(fast.out).to.deep.equal([
                    { path: ['2'], value: 2 }, { path: ['b'], value: 1 }, { path: ['a'], value: 3 },
                ]);
                // Same values/paths overall - order is genuinely the only difference.
                expect(fast.out.map((e) => e.path)).to.have.deep.members(real.out.map((e) => e.path));
            }));

        // NEW divergence introduced by issue #89 (innermost-only default
        // for a self-nesting descendant match - see StreamContext's
        // innermostOnDescendantKey field comment and ARCHITECTURE.md §4):
        // GenericWalker (this file's header comment; FastPathEvaluator.ts)
        // evaluates each node independently against an already-JSON.parse'd
        // tree and has NO notion of "an outer match was superseded by a
        // deeper one" at all - it still emits every overlapping match, i.e.
        // exactly the real engine's OLD (pre-#89) behavior. Deliberately
        // out of scope to fix here (see issue #89's own PR description) -
        // this test exists so the divergence is pinned and visible instead
        // of silently missing, per that PR's own documentation requirement.
        // A tracking issue for unifying this is linked from the PR.
        it('self-nesting descendant match (issue #89): the real engine is innermost-only, fastPath still emits every overlapping match (KNOWN divergence, not yet unified)', () =>
            Promise.all([
                run('$..a', '{"a":{"b":{"a":{"c":1}}}}\n', { fastPath: false }),
                run('$..a', '{"a":{"b":{"a":{"c":1}}}}\n', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(real.out).to.deep.equal([
                    { path: ['a', 'b', 'a'], value: { c: 1 } },
                ]);
                expect(fast.out).to.deep.equal([
                    { path: ['a', 'b', 'a'], value: { c: 1 } },
                    { path: ['a'], value: { b: { a: { c: 1 } } } },
                ]);
            }));
    });

    // Fallback-classifier trigger cases (issue #78's "fallback design"):
    // input a single JSON.parse can't handle on its own is routed to the
    // real streaming engine, byte-for-byte identical to non-fastPath
    // behavior - including issue #50's exact per-record error-and-resync
    // semantics for a malformed record.
    describe('fallback to the real engine (records a single JSON.parse can\'t handle)', () => {
        it('a malformed record reports one error and resyncs at the next line (issue #50), identical to the default engine', () =>
            Promise.all([
                run('$.a', '{"a":1}\n{oops}\n{"a":3}\n', { fastPath: false }),
                run('$.a', '{"a":1}\n{oops}\n{"a":3}\n', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(real.errors).to.have.lengthOf(1);
                expect(fast.errors).to.have.lengthOf(1);
                // Not a message-string comparison: JsonSaxParser's reported
                // byte "position" is relative to whichever buffer was
                // passed to the parse() call that hit it (see
                // JsonSaxParser.ts's charError/structuralError) - already
                // true of the default engine alone (a chunked .write()
                // reports a different position than one big .write() for
                // the exact same failure), and the fast path hands a
                // fallback record its own isolated line buffer, so the
                // position differs from a single-write baseline for the
                // same structural reason, not a bug. Message *shape* still
                // matches.
                expect(fast.errors[0].message).to.match(/^Unexpected "o" at position \d+ in state START$/);
                expect(fast.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([{ path: ['a'], value: 1 }, { path: ['a'], value: 3 }]);
            }));

        it('a pretty-printed record spanning multiple physical lines is still parsed correctly', () =>
            Promise.all([
                run('$.a', '{\n  "a": 1,\n  "b": 2\n}\n{"a":3}\n', { fastPath: false }),
                run('$.a', '{\n  "a": 1,\n  "b": 2\n}\n{"a":3}\n', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(fast.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([{ path: ['a'], value: 1 }, { path: ['a'], value: 3 }]);
            }));

        it('the """ triple-quote extension (issue #43-style) - JSON.parse can never accept it - still round-trips', () =>
            Promise.all([
                run('$.q', '{"q":"""He said "hi" to me"""}\n{"q":"plain"}\n', { fastPath: false }),
                run('$.q', '{"q":"""He said "hi" to me"""}\n{"q":"plain"}\n', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(fast.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([
                    { path: ['q'], value: 'He said "hi" to me' },
                    { path: ['q'], value: 'plain' },
                ]);
            }));

        it('multiple whitespace-separated values on one line are each still reported', () =>
            Promise.all([
                run('$.a', '{"a":1} {"a":2}\n{"a":3}\n', { fastPath: false }),
                run('$.a', '{"a":1} {"a":2}\n{"a":3}\n', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(fast.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([
                    { path: ['a'], value: 1 }, { path: ['a'], value: 2 }, { path: ['a'], value: 3 },
                ]);
            }));

        it('fast-path-eligible records resume normally after a fallback record completes (no permanent fallback for the rest of the stream)', () =>
            run('$.a', '{"a":1}\n{oops}\n{"a":3}\n{"a":4}\n{"a":5}\n', { fastPath: true }).then((r) => {
                expect(r.out.map((e) => e.value)).to.deep.equal([1, 3, 4, 5]);
                expect(r.errors).to.have.lengthOf(1);
            }));
    });

    describe('size cutoff / memory safety (fastPathMaxRecordBytes)', () => {
        it('a record over the cutoff is routed to the real engine instead of being JSON.parse\'d by the fast path', () =>
            Promise.all([
                run('$.a', `{"a":"${'x'.repeat(100)}","junk":"${'y'.repeat(100)}"}\n{"a":"small"}\n`,
                    { fastPath: false, fastPathMaxRecordBytes: 40 }),
                run('$.a', `{"a":"${'x'.repeat(100)}","junk":"${'y'.repeat(100)}"}\n{"a":"small"}\n`,
                    { fastPath: true, fastPathMaxRecordBytes: 40 }),
            ]).then(([real, fast]) => {
                expect(fast.out).to.deep.equal(real.out);
                expect(fast.out.map((e) => e.value)).to.deep.equal([`${'x'.repeat(100)}`, 'small']);
            }));

        it('records at/under the cutoff still take the fast path (control)', () =>
            run('$.a', '{"a":1}\n', { fastPath: true, fastPathMaxRecordBytes: 40 }).then((r) => {
                expect(r.out).to.deep.equal([{ path: ['a'], value: 1 }]);
                expect(r.errors).to.have.lengthOf(0);
            }));
    });

    describe('chunk-boundary safety', () => {
        // Every possible two-way split point of a stream that contains a
        // fast-path record, a malformed (fallback+resync) record, and
        // another fast-path record - the fast path's line-accumulation/
        // relay-mode handoff must be correct no matter where a write()
        // call happens to end, exactly like 05-chunk-boundary.ts already
        // guards for the default engine's own byte-by-byte tokenizer.
        it('produces identical events no matter how the input is split across write() calls', async () => {
            const input = Buffer.from('{"a":1}\n{oops}\n{"a":{"b":2}}\n');
            const baseline = await run('$.a', input, { fastPath: true });
            expect(baseline.out.length).to.be.greaterThan(0);
            for (let i = 1; i < input.length; i++) {
                const actual = await runChunks('$.a', [input.subarray(0, i), input.subarray(i)], { fastPath: true });
                expect(actual.out, `split at byte offset ${i}/${input.length}`).to.deep.equal(baseline.out);
                expect(actual.errors.length, `split at byte offset ${i}/${input.length}`)
                    .to.equal(baseline.errors.length);
            }
        });

        it('produces identical events with one byte per write() call', async () => {
            const input = Buffer.from('{"a":1}\n{oops}\n{"a":{"b":2}}\n');
            const baseline = await run('$.a', input, { fastPath: true });
            const oneByteAtATime = Array.from(input, (b) => Buffer.from([b]));
            const actual = await runChunks('$.a', oneByteAtATime, { fastPath: true });
            expect(actual.out).to.deep.equal(baseline.out);
            expect(actual.errors.length).to.equal(baseline.errors.length);
        });

        it('a size-cutoff spill mid-record is still correct when it lands exactly on a write() boundary', async () => {
            const record = `{"a":"${'z'.repeat(50)}"}`;
            const input = Buffer.from(`${record}\n{"a":"small"}\n`);
            const options = { fastPath: true, fastPathMaxRecordBytes: 20 };
            const baseline = await run('$.a', input, options);
            expect(baseline.out.map((e) => e.value)).to.deep.equal(['z'.repeat(50), 'small']);
            for (const splitAt of [5, 20, 21, record.length, record.length + 1]) {
                const actual = await runChunks('$.a', [input.subarray(0, splitAt), input.subarray(splitAt)], options);
                expect(actual.out, `split at ${splitAt}`).to.deep.equal(baseline.out);
            }
        });
    });

    describe('empty/whitespace-only input', () => {
        it('reports the same "no data" error as the default engine for empty input', () =>
            Promise.all([run('$', '', { fastPath: false }), run('$', '', { fastPath: true })]).
                then(([real, fast]) => {
                    expect(real.errors).to.have.lengthOf(1);
                    expect(fast.errors).to.have.lengthOf(1);
                    expect(fast.errors[0].message).to.equal(real.errors[0].message);
                }));

        it('reports the same "no data" error for whitespace-only input', () =>
            Promise.all([run('$', '   \n  \n', { fastPath: false }), run('$', '   \n  \n', { fastPath: true })]).
                then(([real, fast]) => {
                    expect(real.errors).to.have.lengthOf(1);
                    expect(fast.errors).to.have.lengthOf(1);
                    expect(fast.errors[0].message).to.equal(real.errors[0].message);
                }));

        it('a trailing record with no final newline is still processed', () =>
            Promise.all([
                run('$.a', '{"a":1}\n{"a":2}', { fastPath: false }),
                run('$.a', '{"a":1}\n{"a":2}', { fastPath: true }),
            ]).then(([real, fast]) => {
                expect(fast.out).to.deep.equal(real.out);
                expect(real.out).to.deep.equal([{ path: ['a'], value: 1 }, { path: ['a'], value: 2 }]);
            }));
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
