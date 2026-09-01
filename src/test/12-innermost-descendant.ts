
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

// Permanent differential test suite for issue #89: bare `$..a` (a
// descendant selector whose own last step is a plain key, as opposed to a
// wildcard - see StreamContext's innermostOnDescendantKey field comment)
// changed its DEFAULT output for a self-nesting document (one where the
// matched key appears again, nested, inside its own value - comment
// threads, category trees, folder structures) from "emit every overlapping
// match" to "emit only the innermost occurrence per nesting chain".
//
// This file promotes the rigor of the pre-merge scoping spike's
// `claim-a-differential.js` (758 synthetic documents, 0 mismatches against
// a naive-then-filtered reference - see issue #89's own comment thread and
// the now-closed draft PR #91 for that prototype) into the permanent
// suite, but against the REAL production engine (`src/main/yajs.ts` ->
// StreamContext.ts), not a standalone recorder mock. The reference oracle
// below is independent of StreamContext's own implementation (a plain
// recursive walk over the JSON.parse'd document, not YAJSPath/StreamContext
// machinery), so it can't share a bug with the code under test.
//
// Also see src/test/11-property-selector-oracle.ts's own property test,
// which already fuzzes `$..a`-shaped (and every other child/wildcard/
// descendant combination) selectors against a similar ancestor-chain-based
// innermost filter as part of its broader coverage - this file is the
// deeper, issue-#89-specific complement: hand-written edge cases straight
// from the issue text, deliberately deep chains (2 through 12+ levels),
// and interaction coverage (project/drop-keys/pathIncludeArrayIndex) that
// file's generator doesn't exercise at all.

function runYajs(selector: string, doc: unknown, pathIncludeArrayIndex = false): Promise<Array<{ path: unknown[]; value: unknown }>> {
    return new Promise((resolve, reject) => {
        const result: Array<{ path: unknown[]; value: unknown }> = [];
        const stream = yajs(selector, { pathIncludeArrayIndex });
        stream.
            on('data', (data: any) => result.push({ path: data.path, value: data.value })).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
        stream.write(Buffer.from(JSON.stringify(doc)));
        stream.end();
    });
}

// ---------------------------------------------------------------------------
// Independent reference oracle: naive "every occurrence of `key` anywhere in
// the document" (today's pre-#89 `$..key` behavior), with enough tracking
// to filter that list down to "innermost per nesting chain" afterward - see
// 11-property-selector-oracle.ts's own Hit interface comment for why
// containment is tracked via an ancestor-reference CHAIN, not a recursive
// value search: a value search compares scalars by `===`, which for a
// primitive is value equality, not occurrence identity, and would
// misidentify two coincidentally-equal but unrelated scalar matches (e.g.
// two disjoint `null`s) as nested in each other.
// ---------------------------------------------------------------------------
interface Hit { path: string[]; value: unknown; ref: unknown; ancestors: unknown[] }

function naiveOverlapping(root: unknown, key: string): Hit[] {
    const hits: Hit[] = [];
    function walk(val: unknown, path: string[], containers: unknown[]): void {
        if (Array.isArray(val)) {
            val.forEach((el) => walk(el, path, [...containers, val]));
            return;
        }
        if (val === null || typeof val !== 'object') { return; }
        for (const k of Object.keys(val as object)) {
            const v = (val as any)[k];
            const childContainers = [...containers, val];
            if (k === key) {
                // issue #14: a matched value that is itself an array is
                // never captured whole - each element becomes its own
                // independent match, with the array itself as a real
                // ancestor of each element (but never any hit's own ref -
                // see 11-property-selector-oracle.ts's Hit comment).
                if (Array.isArray(v)) {
                    const withArray = [...childContainers, v];
                    v.forEach((el) => hits.push({ path: [...path, key], value: el, ref: el, ancestors: withArray }));
                } else {
                    hits.push({ path: [...path, key], value: v, ref: v, ancestors: childContainers });
                }
            }
            walk(v, [...path, k], childContainers);
        }
    }
    walk(root, [], []);
    return hits;
}

function isNestedIn(hit: Hit, ancestorHit: Hit): boolean {
    if (ancestorHit.ref === null || typeof ancestorHit.ref !== 'object') { return false; }
    return hit.ancestors.includes(ancestorHit.ref);
}

// The reference algorithm issue #89's own scoping investigation verified
// discard-and-replace against: record every overlapping match (today's
// pre-#89 behavior), then keep only the ones that are not themselves an
// ancestor of some OTHER match (i.e. the leaves of each nesting chain).
function filterInnermost(hits: Hit[]): Hit[] {
    return hits.filter((m) => !hits.some((other) => other !== m && isNestedIn(other, m)));
}

function hitKey(h: { path: unknown[]; value: unknown }): string {
    return JSON.stringify(h.path) + '::' + JSON.stringify(h.value);
}

// Runs `$..<key>` through the real engine and asserts its output equals
// the reference's innermost-filtered set, as an unordered set of
// (path, value) pairs (order isn't asserted - see 11-property-selector-
// oracle.ts's own runYajs()/hitKey() for the same convention; the real
// engine's own emission ORDER for issue #89 specifically - innermost
// dispatchers complete depth-first, so the deepest-started match is not
// necessarily emitted first when disjoint branches are interleaved - is
// intentionally not part of this file's contract).
async function assertInnermost(doc: unknown, key = 'a'): Promise<void> {
    const selector = `$..${key}`;
    const expected = new Set(filterInnermost(naiveOverlapping(doc, key)).map(hitKey));
    const actual = await runYajs(selector, doc);
    const actualSet = new Set(actual.map(hitKey));
    expect(actualSet, `selector=${selector} doc=${JSON.stringify(doc)}\n  expected=${[...expected].join('|')}\n  actual=${[...actualSet].join('|')}`).
        to.deep.equal(expected);
}

// Builds a self-nesting chain of `depth` levels of {[key]: ...}, each
// level also carrying 1-2 unrelated sibling "noise" keys (modeling
// realistic comment/category records that have other fields alongside the
// recursive one), terminating in `leaf`. Mirrors claim-a-differential.js's
// nestingChain() (see its own comment for why this exact shape).
let seed = 1;
function rnd(): number { // small deterministic LCG - reproducible across runs
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}
function rndInt(n: number): number { return Math.floor(rnd() * n); }

function nestingChain(depth: number, key: string, leaf: () => unknown): unknown {
    if (depth <= 0) { return leaf(); }
    const node: any = { [key]: nestingChain(depth - 1, key, leaf), title: `node-${rndInt(1000)}` };
    if (rnd() < 0.4) { node.tags = [rndInt(10), rndInt(10)]; }
    return node;
}

function leaf(): unknown {
    const kind = rndInt(4);
    if (kind === 0) { return rndInt(1000); }
    if (kind === 1) { return `leaf-${rndInt(1000)}`; }
    if (kind === 2) { return { text: 'leaf-object', n: rndInt(5) }; }
    return [rndInt(5), rndInt(5), { text: 'leaf-in-array' }];
}

describe('innermost-only default for self-nesting descendant matches (issue #89)', () => {

    describe('hand-written edge cases from the issue text and claim-a-differential.js', () => {
        it('the issue\'s own example: p.a.a nests, q.a is a disjoint sibling untouched by the other branch', () =>
            Promise.all([
                assertInnermost({ p: { a: { a: 1 } }, q: { a: 2 } }),
                runYajs('$..a', { p: { a: { a: 1 } }, q: { a: 2 } }).then((r) => {
                    expect(r.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                        { path: ['p', 'a', 'a'], value: 1 },
                        { path: ['q', 'a'], value: 2 },
                    ]);
                }),
            ]).then(() => undefined));

        it('a single non-nested match is unaffected (no-op control)', () => assertInnermost({ a: 1 }));

        it('no match at all', () => assertInnermost({ x: 1 }));

        it('a 5-level self-nesting chain keeps only the deepest leaf', () =>
            runYajs('$..a', { a: { a: { a: { a: { a: 'deep leaf' } } } } }).then((r) => {
                expect(r.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: ['a', 'a', 'a', 'a', 'a'], value: 'deep leaf' },
                ]);
            }));

        it('nesting through an unrelated intermediate key still counts as self-nesting', () =>
            runYajs('$..a', { a: { b: { a: 1 } } }).then((r) => {
                expect(r.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: ['a', 'b', 'a'], value: 1 },
                ]);
            }));

        it('an array of two disjoint nested "a"s inside outer "a": each array element discards its own outer wrapper independently', () =>
            runYajs('$..a', { a: [{ a: 1 }, { a: 2 }] }).then((r) => {
                expect(r.map((e) => e.value)).to.deep.equal([1, 2]);
            }));

        it('an array with mixed nested/non-nested/no-match elements', () =>
            runYajs('$..a', { list: [{ a: { a: 1 } }, { a: 2 }, { b: 1 }] }).then((r) => {
                expect(r.map((e) => e.value)).to.deep.equal([1, 2]);
            }));

        it('two disjoint self-nesting branches are each filtered independently', () =>
            runYajs('$..a', { a: { a: 1 }, b: { a: { a: 2 } } }).then((r) => {
                expect(r.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: ['a', 'a'], value: 1 },
                    { path: ['b', 'a', 'a'], value: 2 },
                ]);
            }));

        it('a self-nesting chain that bottoms out in a scalar leaf (not an object) is still innermost-only, not "emit both"', () =>
            runYajs('$..a', { a: { a: 5 } }).then((r) => {
                // Pre-#89 this delivered BOTH the outer object {a:5} (via its
                // own natural dispatcher close) AND the inner scalar 5 (via
                // the scalar bypass) - the exact issue #38 bug #89 exists to
                // fix. The scalar bypass never touched the dispatcher stack
                // before #89 (see StreamContext.match()'s field comments),
                // which is precisely why a scalar-leaf self-nesting chain
                // needed its own explicit discard path, not just the
                // object/array-spawn branch.
                expect(r.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: ['a', 'a'], value: 5 },
                ]);
            }));

        it('does not leak a discarded outer match across NDJSON document boundaries', () => {
            const input = '{"a":{"a":1}}\n{"a":{"a":2}}\n{"a":3}\n';
            return new Promise<any[]>((resolve, reject) => {
                const result: any[] = [];
                const stream = yajs('$..a');
                stream.
                    on('data', (d: any) => result.push({ path: d.path, value: d.value })).
                    on('end', () => resolve(result)).
                    on('error', reject);
                stream.write(Buffer.from(input));
                stream.end();
            }).then((r) => {
                expect(r).to.deep.equal([
                    { path: ['a', 'a'], value: 1 },
                    { path: ['a', 'a'], value: 2 },
                    { path: ['a'], value: 3 },
                ]);
            });
        });
    });

    describe('scope-correctness invariant: a complete no-op whenever the matched key never self-nests', () => {
        it('a flat object with several distinct keys, none repeated', () =>
            runYajs('$..a', { a: 1, b: 2, c: { d: 3, e: 4 } }).then((r) => {
                expect(r.map((e) => e.value)).to.deep.equal([1]);
            }));

        it('a wide, non-self-nesting tree - every "a" match still delivered, none discarded', () =>
            runYajs('$..a', {
                x: { a: 1 },
                y: { z: { a: 2 } },
                w: [{ a: 3 }, { a: 4 }, { b: 5 }],
            }).then((r) => {
                // No "a" ever contains another "a" here - every occurrence is
                // independent, so the naive/overlapping and innermost-only
                // outputs coincide exactly (issue #89's own required
                // invariant): all four survive.
                expect(r.map((e) => e.value)).to.have.members([1, 2, 3, 4]);
                expect(r).to.have.lengthOf(4);
            }));

        it('random non-self-nesting documents match the naive (unfiltered) reference exactly, at increasing sibling counts', async () => {
            for (let width = 1; width <= 8; width++) {
                const doc: any = {};
                for (let i = 0; i < width; i++) {
                    // Each branch's own key is unique ("a0", "a1", ...) so
                    // the fixed target key "a" (not "a<i>") never recurs
                    // anywhere - every branch nests a DIFFERENT key under
                    // its own "a" match, guaranteeing no self-nesting.
                    doc[`branch${i}`] = { a: { [`inner${i}`]: { deeper: i } } };
                }
                const naive = naiveOverlapping(doc, 'a');
                const filtered = filterInnermost(naive);
                // The no-op invariant itself, checked directly against the
                // reference oracle before even touching the real engine:
                // with no self-nesting anywhere, filtering must change
                // nothing.
                expect(filtered).to.have.lengthOf(naive.length);
                await assertInnermost(doc);
            }
        });
    });

    describe('self-nesting at varying depths (2 through 12+), differential against the reference oracle', () => {
        for (const depth of [2, 3, 4, 5, 7, 10, 12]) {
            it(`depth ${depth}: a pure self-nesting chain with sibling noise keys at every level`, () =>
                assertInnermost(nestingChain(depth, 'a', leaf)));
        }

        it('100 random documents mixing self-nesting chains (depth 0-10), arrays, and disjoint branches', async () => {
            for (let i = 0; i < 100; i++) {
                const doc: any = { id: rndInt(1e6) };
                const branchCount = 1 + rndInt(4);
                for (let b = 0; b < branchCount; b++) {
                    const depth = rndInt(11);
                    const useArray = rnd() < 0.3;
                    doc[`branch${b}`] = useArray && depth > 0 ?
                        { a: [{ other: 1 }, nestingChain(depth - 1, 'a', leaf), { other: 2 }] } :
                        { wrapper: nestingChain(depth, 'a', leaf) };
                }
                if (rnd() < 0.5) {
                    doc.a = nestingChain(1 + rndInt(10), 'a', leaf);
                }
                await assertInnermost(doc);
            }
        });
    });

    describe('array-transparency carve-outs (issue #14) interacting with issue #89', () => {
        it('a self-nesting chain reached entirely through arrays at every level', () =>
            runYajs('$..a', { a: [{ a: [{ a: 1 }] }] }).then((r) => {
                expect(r.map((e) => e.value)).to.deep.equal([1]);
            }));

        it('array elements are independently self-nesting or not, each judged on its own', () =>
            runYajs('$..a', { a: [{ a: { a: 1 } }, { a: 2 }, { x: 3 }] }).then((r) => {
                // Every element of "a"'s array is itself a separate match
                // for "a" (issue #14 array-transparency flattening), so
                // element0 ({a:{a:1}}) and element1 ({a:2}) both self-nest -
                // each one's own OUTER (array-flatten) match is discarded in
                // favor of its OWN inner "a" property, leaving bare scalars
                // 1 and 2. element2 ({x:3}) has no "a" property inside it at
                // all - its own array-flatten match is NOT self-nesting, so
                // it survives whole, same as the no-op invariant elsewhere
                // in this file, just scoped down to a single array element
                // rather than a whole document.
                expect(r.map((e) => e.value)).to.deep.equal([1, 2, { x: 3 }]);
            }));

        it('deep array-of-arrays self-nesting (5 levels, each hop through an array)', () =>
            runYajs('$..a', { a: [{ a: [{ a: [{ a: [{ a: 42 }] }] }] }] }).then((r) => {
                expect(r.map((e) => e.value)).to.deep.equal([42]);
            }));
    });

    describe('interaction with project ({...}) and drop-keys (<...>)', () => {
        // Project (`{...}`) is a GATE, not a "pick": it emits the matched
        // object UNCHANGED if its own top-level keys satisfy the filter,
        // and suppresses it entirely otherwise (README's "Project" section) -
        // it never strips the object down to just the filtered keys.
        it('project gates on the delivered INNERMOST match\'s own keys only, never on the discarded outer wrapper\'s', () =>
            Promise.all([
                // Outer "a" has no top-level "z" - if project evaluated
                // against the (discarded) OUTER wrapper instead of the
                // innermost match, this would wrongly suppress the match
                // entirely. It doesn't: only the inner "a" (x:3,y:4, which
                // DOES have "x") is ever delivered at all - the outer is
                // discarded before project ever sees it, exactly as a
                // scoping-spike comment predicted ("for innermost, the
                // discarded outer is never delivered, so project/drop-keys
                // only ever sees the one object that actually gets
                // emitted, same as today").
                runYajs('$..a{x}', { a: { x: 1, y: 2, a: { x: 3, y: 4 } } }),
                // Inverted control: project on the INNER match's own missing
                // key ("y" IS present on the inner match here, so use a key
                // the inner match lacks to prove the gate reads the inner
                // object, not the outer) suppresses the match entirely.
                runYajs('$..a{q}', { a: { x: 1, y: 2, a: { x: 3, y: 4 } } }),
            ]).then(([passes, suppressed]) => {
                expect(passes).to.have.lengthOf(1);
                expect(passes[0].value).to.deep.equal({ x: 3, y: 4 });
                expect(suppressed).to.have.lengthOf(0);
            }));

        it('drop-keys applies to the delivered INNERMOST match only', () =>
            runYajs('$..a<y>', { a: { x: 1, y: 2, a: { x: 3, y: 4 } } }).then((r) => {
                expect(r).to.have.lengthOf(1);
                expect(r[0].value).to.deep.equal({ x: 3 });
            }));

        it('project/drop-keys on a non-self-nesting match is a complete no-op (control)', () =>
            Promise.all([
                runYajs('$..a{x}', { a: { x: 1, y: 2 } }),
                runYajs('$..a<y>', { a: { x: 1, y: 2 } }),
            ]).then(([projected, dropped]) => {
                expect(projected.map((e) => e.value)).to.deep.equal([{ x: 1, y: 2 }]);
                expect(dropped.map((e) => e.value)).to.deep.equal([{ x: 1 }]);
            }));
    });

    describe('interaction with pathIncludeArrayIndex', () => {
        it('the delivered innermost match\'s path still carries correct array indices through a discarded outer', () =>
            runYajs('$..a', { list: [{ x: 1 }, { a: { a: 9 } }, { x: 2 }] }, true).then((r) => {
                expect(r).to.deep.equal([
                    { path: ['list', 1, 'a', 'a'], value: 9 },
                ]);
            }));

        it('array indices stay correct for the surviving sibling when another sibling self-nests (issue #89 discard must not disturb StreamPosition)', () =>
            runYajs('$..a', { list: [{ a: { a: 1 } }, { a: 2 }] }, true).then((r) => {
                expect(r).to.deep.equal([
                    { path: ['list', 0, 'a', 'a'], value: 1 },
                    { path: ['list', 1, 'a'], value: 2 },
                ]);
            }));
    });
});
