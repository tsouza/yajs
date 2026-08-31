
import { createReadStream } from 'fs';
import { Readable, Writable } from 'stream';
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

describe('yajs', () => {

    it('should parse simple json', () =>
        Promise.all([test('simple', '$').then((r) => r[0]),
            toString('simple').then((j) => JSON.parse(j))]).
            then(([actual, expected]: [any, any]) => {
                expect(actual.path).to.be.empty;
                expect(actual.value).to.be.deep.equal(expected);
            }));

    it('should parse triple double quotes json', () =>
        test('triple-dquotes', '$').then((r) => r[0]).
        then((actual: any) => {
            expect(actual.path).to.be.empty;
            expect(actual.value).to.be.deep.equal({
                test1: '',
                test2: '\n    "test" \\"test\\" ""\n',
                test3: '"',
                test4: 'test " test',
            });
    }));

    it('should parse ndjson', () =>
        Promise.all([test('ndjson', '$'),
            toString('ndjson').then((j) => j.
                split('\n').filter((l) => l.length).
                map((l) => JSON.parse(l)))]).
            then(([actual, expected]: [any[], any[]]) => {
                expect(actual).to.lengthOf(4);
                actual.forEach((entry: any, idx: number) => {
                    expect(entry.path).to.be.empty;
                    expect(entry.value).to.be.deep.equal(expected[idx]);
                });
            }));

    it('should access in nested array 1', () =>
        test('array', '$.object4.object5').
            then((array) => {
                expect(array).to.be.lengthOf(6);
                array.forEach((entry) => expect(entry).to.be.deep.equal({
                    path: ['object4', 'object5'],
                    value: { prop2: 'value1' }}));
            }));

    it('should access in nested array 2', () =>
        test('array', '$.path1.path2.path3.path4').
            then((array) => {
                expect(array).to.be.lengthOf(3);
                array.forEach((entry) => expect(entry).to.be.deep.equal({
                    path: ['path1', 'path2', 'path3', 'path4'],
                    value: 'value1' }));
            }));

    it('should access in nested array with filtering', () =>
            test('array', '$..[path1 && path2 && path3]path4').
                then((array) => {
                    expect(array).to.be.lengthOf(3);
                    array.forEach((entry) => expect(entry).to.be.deep.equal({
                        path: ['path1', 'path2', 'path3', 'path4'],
                        value: 'value1' }));
                }));

    it('should access in nested array with filtering and projection', () =>
            test('ndjson', '$..[nested1]nested3{prop1 && prop2}').
                then((array) => {
                    expect(array).to.be.lengthOf(3);
                    array.forEach((entry) => expect(entry).to.be.deep.equal({
                        path: ['nested1', 'nested2', 'nested3'],
                        value: { prop1: 'value1', prop2: 'value2' }}));
                }));

    it('should drop keys', () =>
        test('ndjson-drop', '$<nested1 num2 group1 prop1 object1 object3 object4 path1>').
            then((array) => {
                expect(array).to.be.lengthOf(2);
                array.forEach((entry) => expect(entry).to.be.deep.equal({
                    path: [], value: { num: [ 6, 1 ] } }));
            }));

    it('should parse bare strings at the root', () =>
        test('string', '$').then((array) => {
            expect(array).to.be.lengthOf(2);
            expect(array[0]).to.be.deep.equal({ path: [], value: 'a' });
            expect(array[1]).to.be.deep.equal({ path: [], value: 'b' });
        }));

    it('should parse a bare number at the root', () =>
        test('number', '$').then((array) => {
            expect(array).to.be.lengthOf(1);
            expect(array[0]).to.be.deep.equal({ path: [], value: 42 });
        }));

    it('should parse bare booleans at the root', () =>
        test('boolean', '$').then((array) => {
            expect(array).to.be.lengthOf(2);
            expect(array[0]).to.be.deep.equal({ path: [], value: true });
            expect(array[1]).to.be.deep.equal({ path: [], value: false });
        }));

    it('should parse a bare null at the root', () =>
        test('null', '$').then((array) => {
            expect(array).to.be.lengthOf(1);
            expect(array[0]).to.be.deep.equal({ path: [], value: null });
        }));

    it('should include array index in path', () =>
        test('array-index', '$..path1', true).
            then((array) => {
                expect(array).to.be.lengthOf(3);
                expect(array[0]).to.be.deep.equal({
                    path: [ 'deep', 'nested', 'array', 1, 'path1' ],
                    value: 1 });
                expect(array[1]).to.be.deep.equal({
                    path: [ 'deep', 'nested', 'array', 3, 'path1' ],
                    value: 1 });
                expect(array[2]).to.be.deep.equal({
                    path: [ 'deep', 'nested', 'array', 4, 'path1' ],
                    value: 1 });
                }));

    // Regression test found while verifying the issue #14 nested-array fix:
    // stepIntoObject() increments the parent array's running index before
    // descending into a new object element, but stepIntoArray() didn't do
    // the same before descending into a new element that turns out to be
    // an array itself - harmless before #14 (a nested array was always
    // flattened straight through to its own scalar elements, whose own
    // onValue() correctly increments the index), but once a nested array
    // became a matched value in its own right, its own position in the
    // parent array stayed stuck at ArrayIndex's uninitialized -1 default.
    it('should track the correct array index for a matched nested array, ' +
        'not the uninitialized default', () =>
        testJson('[[1,2],[3,4]]', '$', true).then((array) => {
            expect(array).to.be.lengthOf(2);
            expect(array[0]).to.be.deep.equal({ path: [ 0 ], value: [ 1, 2 ] });
            expect(array[1]).to.be.deep.equal({ path: [ 1 ], value: [ 3, 4 ] });
        }));

    // Found via adversarial review of the fix above: StreamContext.onValue()
    // had the identical missing-increaseArrayIndex() bug for a SCALAR
    // sibling (not just an array-typed one) sitting directly in an
    // already-open array's elements slot - and left uncorrected, a single
    // scalar sibling didn't just report its own index as -1, it silently
    // desynced the index reported for every later sibling too, since the
    // increment the position was relying on it to provide never happened.
    it('should track the correct array index for scalar array elements, ' +
        'and not desync the index for later siblings', () =>
        testJson('[1,2,3]', '$', true).then((array) => {
            expect(array).to.be.lengthOf(3);
            expect(array[0]).to.be.deep.equal({ path: [ 0 ], value: 1 });
            expect(array[1]).to.be.deep.equal({ path: [ 1 ], value: 2 });
            expect(array[2]).to.be.deep.equal({ path: [ 2 ], value: 3 });
        }));

    it('should not let a scalar sibling desync the index of a later ' +
        'array-typed sibling', () =>
        testJson('[1,[9,8],3]', '$', true).then((array) => {
            expect(array).to.be.lengthOf(3);
            expect(array[0]).to.be.deep.equal({ path: [ 0 ], value: 1 });
            expect(array[1]).to.be.deep.equal({ path: [ 1 ], value: [ 9, 8 ] });
            expect(array[2]).to.be.deep.equal({ path: [ 2 ], value: 3 });
        }));

    // Regression tests for GitHub issue #12: an object key that collides
    // with either the special `__proto__` accessor or an inherited
    // Object.prototype method name used to be silently dropped (or, for
    // `__proto__` specifically, misinterpreted as reassigning the built
    // object's actual prototype) even with plain `$` and no drop-keys
    // `<...>` selector syntax anywhere in the path. See
    // AbstractObjectBuilder.ts (ObjectNode.handle and the dropKeys lookup
    // table) for the fix.
    describe('Object.prototype-colliding keys (issue #12)', () => {

        it('round-trips an object with a "__proto__" key as an own data property, without polluting the prototype chain', () =>
            testJson('{"__proto__":{"a":1}}', '$').then((array) => {
                expect(array).to.be.lengthOf(1);
                const value = array[0].value;
                expect(value).to.be.deep.equal(JSON.parse('{"__proto__":{"a":1}}'));
                expect(Object.getPrototypeOf(value)).to.equal(Object.prototype);
                expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).to.be.true;
                expect(Object.getOwnPropertyDescriptor(value, '__proto__').enumerable).to.be.true;
            }));

        it('round-trips a "valueOf" key with a falsy value', () =>
            testJson('{"valueOf":false}', '$').then((array) => {
                expect(array).to.be.lengthOf(1);
                expect(array[0].value).to.be.deep.equal({ valueOf: false });
            }));

        it('round-trips a "toString" key', () =>
            testJson('{"toString":"hello"}', '$').then((array) => {
                expect(array).to.be.lengthOf(1);
                expect(array[0].value).to.be.deep.equal({ toString: 'hello' });
            }));

        it('round-trips a "hasOwnProperty" key', () =>
            testJson('{"hasOwnProperty":1}', '$').then((array) => {
                expect(array).to.be.lengthOf(1);
                expect(array[0].value).to.be.deep.equal({ hasOwnProperty: 1 });
            }));

        it('round-trips a "constructor" key', () =>
            testJson('{"constructor":"ctor"}', '$').then((array) => {
                expect(array).to.be.lengthOf(1);
                expect(array[0].value).to.be.deep.equal({ constructor: 'ctor' });
            }));

        it('still handles a legitimate "length" key on a plain object (not an Object.prototype collision)', () =>
            testJson('{"length":5}', '$').then((array) => {
                expect(array).to.be.lengthOf(1);
                const value = array[0].value;
                expect(value).to.be.deep.equal({ length: 5 });
                expect(Object.prototype.hasOwnProperty.call(value, 'length')).to.be.true;
            }));
    });

    // Regression tests for GitHub issue #13: the selector grammar's drop-keys
    // `<...>`, project `{...}` and filter `[...]` syntax could never target a
    // key literally named "__proto__", because extractKeys()/doExtractKeys()
    // in src/main/lib/path/parser/utils.ts collected keys into a plain `{}`
    // object, where assigning to a "__proto__" property is silently routed
    // through Object.prototype's inherited accessor setter instead of
    // creating a real own property. See utils.ts (extractKeys) and
    // ScriptFilterHelper.ts (_createArgs), which had the same bug class, for
    // the fix.
    describe('selector syntax targeting a "__proto__" key (issue #13)', () => {

        it('drops a "__proto__" key via the drop-keys <...> selector', () =>
            testJson('{"__proto__":1,"b":2}', '$<__proto__>').then((array) => {
                expect(array).to.be.lengthOf(1);
                expect(array[0].value).to.be.deep.equal({ b: 2 });
            }));

        it('keeps a "__proto__" key untouched when it is not the dropped one', () =>
            testJson('{"__proto__":1,"b":2}', '$<b>').then((array) => {
                expect(array).to.be.lengthOf(1);
                // Note: can't compare against an `{ __proto__: 1 }` object
                // literal here - since 1 isn't an object, that literal syntax
                // is a no-op and evaluates to plain `{}`. Build the expected
                // value via JSON.parse instead, as the issue #12 tests above do.
                expect(array[0].value).to.be.deep.equal(JSON.parse('{"__proto__":1}'));
                expect(Object.getPrototypeOf(array[0].value)).to.equal(Object.prototype);
            }));

        it('filters a descendant match on a "__proto__" ancestor key via the [...] selector', () =>
            testJson('{"__proto__":{"target":"value1"},"safe":{"target":"value2"}}',
                '$..[__proto__]target').
                then((array) => {
                    expect(array).to.be.lengthOf(1);
                    expect(array[0].value).to.equal('value1');
                }));
    });

    // Regression test for GitHub issue #17: a filter key containing an
    // apostrophe used to be interpolated unescaped into a JS string literal
    // in generated code compiled via vm.runInContext (`args['${key}']`), so
    // it broke out of the string and crashed with a raw SyntaxError instead
    // of being treated as an ordinary key name. Fixed via JSON.stringify in
    // utils.ts's doBuildArgsExpression().
    describe('selector syntax targeting a key containing an apostrophe (issue #17)', () => {

        it('filters a descendant match on an ancestor key containing an ' +
            'apostrophe via the [...] selector, without throwing', () =>
            testJson('{"key\'s":{"target":"value1"},"safe":{"target":"value2"}}',
                "$..[key's]target").
                then((array) => {
                    expect(array).to.be.lengthOf(1);
                    expect(array[0].value).to.equal('value1');
                }));
    });

    // Regression tests for GitHub issue #26: buildArgsExpression()/
    // extractKeys() only recursed into children that were themselves a
    // FilterExpressionTermContext, which misses several grammar-legal shapes
    // entirely - a parenthesized group (`LP filterExpression RP`, stored as
    // `ctx._expr`, a FilterExpressionContext rather than a
    // FilterExpressionTermContext), an adjacent bare-key list with no
    // explicit `&&`/`||` between terms (the README's documented "keys
    // filter" style, e.g. `{prop1 prop2}`), and a leading bare `&&`/`||`
    // with no left-hand operand. All three used to either crash the process,
    // silently drop keys / match nothing, or throw a raw, confusing
    // vm.runInContext SyntaxError from deep inside the library instead of a
    // clean, catchable error. See utils.ts for the fix.
    describe('filter/project expression compiler (issue #26)', () => {

        it('matches a parenthesized-group filter, simple and nested, combined with && and ||', () =>
            testJson(JSON.stringify({
                ab: { a: { b: { x: 'm1' } } },
                dOnly: { d: { x: 'm2' } },
                cd: { c: { d: { x: 'm3' } } },
                eOnly: { e: { x: 'm4' } },
            }), '$..[(a && b) || (!c && d)]x').
                then((array) => {
                    expect(array).to.have.lengthOf(2);
                    expect(array.map((e) => e.value)).to.deep.equal(['m1', 'm2']);
                }));

        it('matches an adjacent two-key bare list in a [...] filter as an OR (issue\'s own repro path, via the CLI-equivalent .pipe() flow)', () =>
            testJson(JSON.stringify({
                a: { x: 'v1' }, c: { x: 'v2' }, b: { x: 'v3' },
            }), '$..[a b]x').
                then((array) => {
                    expect(array).to.have.lengthOf(2);
                    expect(array.map((e) => e.value)).to.deep.equal(['v1', 'v3']);
                }));

        it('matches an adjacent three-or-more-key bare list in a [...] filter as an OR', () =>
            testJson(JSON.stringify({
                a: { x: 'v1' }, m: { x: 'v2' }, b: { x: 'v3' }, c: { x: 'v4' },
            }), '$..[a b c]x').
                then((array) => {
                    expect(array).to.have.lengthOf(3);
                    expect(array.map((e) => e.value)).to.deep.equal(['v1', 'v3', 'v4']);
                }));

        it('gates emission of the whole object on an adjacent bare-key list via {...} without crashing (issue\'s own direct .write() repro)', () =>
            // Note: `{...}` is a boolean gate on whether to emit the whole
            // matched object (per the README: "Will emit only if keys
            // filter evaluates to true"), not a key-projection/pick - so
            // prop3 (not one of the listed keys) is still expected in the
            // emitted value once the gate passes.
            Promise.all([
                testJson(JSON.stringify({ foo: { prop1: 'v1', prop2: 'v2', prop3: 'v3' } }),
                    '$.foo{prop1 prop2}'),
                testJson(JSON.stringify({ foo: { prop3: 'v3' } }),
                    '$.foo{prop1 prop2}'),
            ]).then(([withEitherKey, withNeitherKey]) => {
                expect(withEitherKey).to.have.lengthOf(1);
                expect(withEitherKey[0].value).to.deep.equal({ prop1: 'v1', prop2: 'v2', prop3: 'v3' });
                expect(withNeitherKey).to.have.lengthOf(0);
            }));

        it('rejects a selector with a leading bare && with no left-hand operand via a clean, synchronous, catchable Error (issue\'s own repro), instead of a raw VM SyntaxError', () => {
            expect(() => yajs('$.[&&x]y')).to.throw(/has no left-hand operand/);
        });

        it('rejects a selector with a leading bare || with no left-hand operand the same way', () => {
            expect(() => yajs('$.[||x]y')).to.throw(/has no left-hand operand/);
        });
    });

    // Regression tests for GitHub issue #46: StreamContext used to gate
    // scalar matching entirely on `isEmpty(path.projectExpression)` - i.e.
    // it only ever attempted to match a scalar value against the path at
    // all when there was no `{...}` project clause, on the assumption that
    // a projected path's match target is always an object (there's nothing
    // to project/gate-on-keys-of for a scalar). That assumption doesn't
    // hold: a scalar can still genuinely BE the whole matched value at a
    // projected path (e.g. "$.a{x}" against {"a":5} - "a" is the match, and
    // it happens to be a number). The old code silently dropped that case
    // entirely - no match attempted, nothing emitted, no error. Since
    // "project/gate on properties" has no defined meaning for a scalar in
    // the first place, the fix makes a matched scalar always bypass the
    // project/filter check and get emitted as-is, exactly as it already
    // does for a plain (non-projected) path.
    describe('project syntax {...} on a scalar match (issue #46)', () => {

        it('emits the scalar unprojected instead of silently dropping it (own repro: $.a{x} vs {"a":5})', () =>
            testJson('{"a":5}', '$.a{x}').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: ['a'], value: 5 } ]);
            }));

        it('still gates on key presence for an object match (must not regress - object case is unaffected)', () =>
            testJson('{"a":{"x":1,"y":2}}', '$.a{x}').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([{ x: 1, y: 2 }]);
            }));

        it('still matches a plain (non-projected) scalar path (regression guard - $.a vs {"a":5})', () =>
            testJson('{"a":5}', '$.a').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([5]);
            }));

        it('emits a string scalar unprojected', () =>
            testJson('{"a":"str"}', '$.a{x}').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal(['str']);
            }));

        it('emits a null scalar unprojected, not confusing it with "no match"', () =>
            testJson('{"a":null}', '$.a{x}').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([null]);
            }));

        it('emits a boolean scalar unprojected', () =>
            testJson('{"a":true}', '$.a{x}').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([true]);
            }));

        it('does not spuriously match an unrelated sibling scalar (sanity - $.a{x} vs {"a":{"x":1},"b":2})', () =>
            testJson('{"a":{"x":1},"b":2}', '$.a{x}').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([{ x: 1 }]);
            }));
    });

    // Regression tests for GitHub issue #35: a deeply parenthesized filter
    // expression used to overflow the JS call stack (uncaught RangeError)
    // straight out of the synchronous yajs() call, at a nesting depth of
    // roughly 2,000 - inconsistent with the "malformed/pathological
    // selectors fail cleanly" principle established by issues #18/#19/#23.
    // The fix (see parser/utils.ts) makes the recursive tree-walk added for
    // issue #26 iterative (an explicit stack instead of the JS call stack),
    // and additionally avoids emitting real nested parens in the compiled
    // JS for redundant single-term groups, since V8's own JS-source parser
    // (used by the `new vm.Script(...)` compile step in ScriptFilterHelper)
    // is separately recursive and was found to overflow at a similarly low
    // depth on real nested parens - so fixing only this codebase's own walk
    // was not sufficient on its own to fix the crash end-to-end.
    describe('deeply nested parenthesized filter expressions (issue #35)', () => {

        const data = { a: { x: 'v1' }, c: { x: 'v2' }, b: { x: 'v3' } };

        it('filters correctly through a few hundred levels of redundant parenthesized nesting around a single key', () =>
            Promise.all([
                testJson(JSON.stringify(data), `$..[${'('.repeat(300)}a${')'.repeat(300)}]x`),
                testJson(JSON.stringify(data), '$..[a]x'),
            ]).then(([nested, plain]) => {
                expect(nested.map((e) => e.value)).to.deep.equal(['v1']);
                expect(nested.map((e) => e.value)).to.deep.equal(plain.map((e) => e.value));
            }));

        it('does not throw a RangeError and still filters correctly at the depth from the issue\'s own repro (2,500 levels)', () =>
            // 2,500 stays with comfortable margin below the ANTLR-generated
            // parser's own separate, third-party nesting ceiling for simply
            // building a parse tree (confirmed empirically to be ~3,000
            // under a worker-thread test runner like this one, and
            // ~4,000-5,000 on the main thread - see 01-parser.ts's issue #35
            // tests), so this stays a reliable regression test for this
            // codebase's own fix rather than depending on exactly where that
            // other, out-of-scope ceiling happens to sit.
            Promise.all([
                testJson(JSON.stringify(data), `$..[${'('.repeat(2500)}a${')'.repeat(2500)}]x`),
                testJson(JSON.stringify(data), '$..[a]x'),
            ]).then(([nested, plain]) => {
                expect(nested.map((e) => e.value)).to.deep.equal(['v1']);
                expect(nested.map((e) => e.value)).to.deep.equal(plain.map((e) => e.value));
            }));
    });

    // Regression tests for GitHub issues #14 and #15: a matched array's
    // immediate elements must each be streamed as one whole value, the same
    // way an object element already was (see 'should access in nested array
    // 1' above, matching object5's array-of-objects) - including an element
    // that is itself an array, which used to be recursively flattened all
    // the way down to its leaf scalars instead of being captured whole
    // (StreamPosition's hasOnlyArrayIndex treated every array-open as a
    // fresh top-level candidate, and ObjectDispatcher.endArray() never
    // dispatched even when it was captured). See StreamPosition.ts,
    // StreamContext.ts (startArray/startObject/onValue) and
    // ObjectDispatcher.ts (endArray) for the fix.
    describe('nested array streaming (issues #14, #15)', () => {

        it('streams a nested array\'s immediate elements as whole arrays, not recursively flattened scalars (issue #14\'s own repro)', () =>
            testJson('[[1,2],[3,4]]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([[1, 2], [3, 4]]);
            }));

        it('still streams a flat array of scalars one scalar at a time (must not regress)', () =>
            testJson('[1,2,3]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2, 3]);
            }));

        it('still streams a flat array of objects one whole object at a time (must not regress)', () =>
            testJson('[{"a":1},{"a":2}]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([{ a: 1 }, { a: 2 }]);
            }));

        it('streams a nested array reached via a named key path, not just bare $ (nested inside an object)', () =>
            testJson('{"a":[[1,2],[3,4]]}', '$.a').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([[1, 2], [3, 4]]);
            }));

        it('captures an array nested arbitrarily deep inside a matched element as one whole value (only the outermost level streams)', () =>
            testJson('[[[1,2]],[3,[4,5]]]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([[[1, 2]], [3, [4, 5]]]);
            }));

        it('captures an empty nested array as [], not zero emissions', () =>
            testJson('[[],[1],[]]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([[], [1], []]);
            }));

        it('handles a heterogeneous array (scalar, array, object, scalar) - each element whole, regardless of type', () =>
            testJson('[1,[2,3],{"x":4},5]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, [2, 3], { x: 4 }, 5]);
            }));

        // An object sibling between two array siblings of the same matched
        // array used to lose track of the fact it was still inside that
        // array at all: startObject()/onValue() unconditionally replaced
        // the whole StreamPosition on every isInRoot()-triggered match,
        // discarding the outer array's own tracking, so the array sibling
        // AFTER the object looked like a brand new top-level candidate and
        // got flattened instead of captured whole. Fixed by only ever
        // replacing position at a genuine document/NDJSON boundary
        // (position undefined, or back at bare root) - see startObject()'s
        // and onValue()'s isInRoot() checks in StreamContext.ts.
        it('captures an array sibling that comes after an object sibling in the same matched array (position must not be lost across a heterogeneous sibling)', () =>
            testJson('[[1,2],{"a":9},[3,4]]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([[1, 2], { a: 9 }, [3, 4]]);
            }));

        it('still captures each object element of a matched array whole via a named key path (must not regress $.object4.object5-style matching)', () =>
            testJson('{"a":{"object5":[{"x":1},{"x":2}]}}', '$.a.object5').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([{ x: 1 }, { x: 2 }]);
            }));

        it('still resets between NDJSON documents, even when each is itself a nested array', () =>
            testJson('[[1,2],[3,4]]\n[[5,6],[7,8]]\n', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([[1, 2], [3, 4], [5, 6], [7, 8]]);
            }));

        it('still matches "..." descendant paths reaching into an array, unaffected by the array-transparency fix (regression guard)', () =>
            testJson('{"deep":{"nested":{"array":[1,{"path1":1},3]}}}', '$..path1').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1]);
            }));
    });

    // Regression tests for GitHub issue #20: '$.*' never matched array
    // elements, only object properties - a bare top-level array (or an
    // array reached via a named key) produced no matches at all for a
    // wildcard step. Root cause was in YAJSPath.match()'s array-transparency
    // loop (see the "Wildcard is different" comment there): retrying the
    // SAME Wildcard pattern operator against whatever lay beneath the array
    // let its unconditional match() silently consume the pattern's own
    // trailing Root operator's rightful match target, leaving Root with
    // nothing left to pair against.
    describe('wildcard matching array elements (issue #20)', () => {

        it('matches each element of a flat top-level array of scalars (issue\'s own repro)', () =>
            testJson('[1,2,3]', '$.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2, 3]);
            }));

        it('still matches each property of a top-level object (must not regress)', () =>
            testJson('{"a":1,"b":2}', '$.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2]);
            }));

        it('matches a named key inside each object element of a top-level array (wildcard then child)', () =>
            testJson('[{"b":1},{"b":2}]', '$.*.b').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2]);
            }));

        it('matches each element of an array nested under a named key', () =>
            testJson('{"arr":[1,2,3]}', '$.arr.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2, 3]);
            }));

        it('captures each element of a top-level array-of-arrays whole via a single wildcard, mirroring bare $ (one level of streaming only)', () =>
            testJson('[[1,2],[3,4]]', '$.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([[1, 2], [3, 4]]);
            }));

        it('does not match a wrong key inside an array\'s object elements (wildcard\'s permissive match must not mask a real key mismatch)', () =>
            testJson('{"a":[1,2,3]}', '$.b').then((array) => {
                expect(array).to.be.lengthOf(0);
            }));

        it('still matches "..*" descendant-wildcard scans reaching into a plain array (regression guard, unaffected by the wildcard-retry fix)', () =>
            testJson('{"a":[1,2,3]}', '$..*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2, 3]);
            }));

        it('still streams a flat array of scalars one at a time via bare $ (regression guard, unaffected by the wildcard-retry fix)', () =>
            testJson('[1,2,3]', '$').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2, 3]);
            }));
    });

    // Regression tests for GitHub issue #27: a descendant scan ('..')
    // preceded by a named key or wildcard used to silently mismatch through
    // arrays - see 02-path.ts for the detailed root-cause writeup and unit
    // tests directly on YAJSPath.match(); these confirm the fix end-to-end
    // through the real parser and streaming machinery.
    describe('descendant scan through arrays (issue #27)', () => {

        it('finds a match past an array preceded by a named key (own repro: $.a..b vs {"a":[{"b":2}]})', () =>
            testJson('{"a":[{"b":2}]}', '$.a..b').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([2]);
            }));

        it('still finds a match with no array involved at all (regression guard)', () =>
            testJson('{"a":{"y":{"b":2}}}', '$.a..b').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([2]);
            }));

        it('finds a match past an array preceded by a wildcard, not just a named key (own repro: $.*..b)', () =>
            testJson('{"a":[{"b":2}]}', '$.*..b').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([2]);
            }));

        it('finds a match past an array in a longer chain ($.a.b..c)', () =>
            testJson('{"a":{"b":[{"c":5}]}}', '$.a.b..c').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([5]);
            }));

        it('does not spuriously match through an array when the sought key never occurs anywhere (own repro: $..x..y - "x" is never present)', () =>
            testJson('{"foo":{"bar":[{"y":"oops"}]}}', '$..x..y').then((array) => {
                expect(array).to.be.lengthOf(0);
            }));

        it('finds a match past two consecutive nested arrays (adversarial)', () =>
            testJson('{"a":[[{"c":1}]]}', '$.a..c').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1]);
            }));
    });

    // Regression tests for GitHub issue #45: a descendant scan following a
    // named key ('$.a..x') used to commit to the NEAREST ancestor "a" and
    // never reconsider that choice, so a real match nested under a FARTHER
    // "a" (with a closer, non-qualifying "a" in between) was silently
    // missed whenever the nearer one didn't ultimately pan out against the
    // rest of the pattern. See 02-path.ts for the detailed root-cause
    // writeup and unit tests directly on YAJSPath.match(); these confirm
    // the fix end-to-end.
    describe('descendant backtracking across repeated ancestor keys (issue #45)', () => {

        it('backtracks past a closer non-qualifying "a" to the outer, qualifying one (own repro: $.a..x vs {"a":{"c":{"a":{"x":1}}}})', () =>
            testJson('{"a":{"c":{"a":{"x":1}}}}', '$.a..x').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: ['a', 'c', 'a', 'x'], value: 1 } ]);
            }));

        it('still matches when only a single "a" is present (regression guard)', () =>
            testJson('{"a":{"x":1}}', '$.a..x').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1]);
            }));

        it('still correctly finds no match when "a" only ever occurs nested, never as a direct child of root (must not become a false positive)', () =>
            testJson('{"c":{"a":{"x":1}}}', '$.a..x').then((array) => {
                expect(array).to.be.lengthOf(0);
            }));
    });

    // Regression tests for GitHub issue #28: '$.*' reaching an array of
    // objects used to spuriously match nested field values in addition to
    // the correct whole-element matches, and in the worst case a spurious
    // match's own dispatcher would hijack events meant for the real element
    // match, corrupting it (dropping a key). See 02-path.ts for the
    // detailed root-cause writeup and unit tests directly on
    // YAJSPath.match(); these confirm the fix end-to-end.
    describe('wildcard leak through array elements (issue #28)', () => {

        it('matches only each whole element, not their field values (own repro: $.* vs [{"x":1,"y":2},{"x":3,"y":4}])', () =>
            testJson('[{"x":1,"y":2},{"x":3,"y":4}]', '$.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([
                    { x: 1, y: 2 }, { x: 3, y: 4 } ]);
            }));

        it('does not corrupt the real element match by dropping a key to a spurious concurrent match (own repro: $.* vs [{"x":{"deep":1}}])', () =>
            testJson('[{"x":{"deep":1}}]', '$.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([ { x: { deep: 1 } } ]);
            }));

        it('does not leak when the nested field\'s own value is an array, not just an object (adversarial variant)', () =>
            testJson('[{"x":[1,2],"y":3}]', '$.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([ { x: [1, 2], y: 3 } ]);
            }));

        it('does not leak three levels deep (adversarial)', () =>
            testJson('[{"x":{"deep":{"deeper":1}}}]', '$.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([ { x: { deep: { deeper: 1 } } } ]);
            }));

        it('still lets a chain of wildcards reach one hop at a time through an array ($.*.*, must not regress)', () =>
            testJson('[{"a":1,"b":2},{"c":3}]', '$.*.*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2, 3]);
            }));

        it('still lets a descendant-wildcard reach a property nested inside an array element ($..*, must not regress)', () =>
            testJson('{"a":[{"x":1}]}', '$..*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, { x: 1 }]);
            }));

        it('still matches a named key inside array elements via $.*.b (issue #20, must not regress)', () =>
            testJson('[{"b":1},{"b":2}]', '$.*.b').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([1, 2]);
            }));
    });

    // Regression test for GitHub issue #29: drop-keys (<...>) used to parse
    // &&/||/! and parens without error but silently ignore them, always
    // dropping every named key unconditionally. See 02-path.ts for the
    // detailed root-cause writeup and parser-level unit tests; this
    // confirms the parse-time rejection surfaces through the real yajs()
    // entry point too.
    describe('drop-keys with boolean operators (issue #29)', () => {

        it('throws synchronously from yajs() for a drop-keys expression using &&, instead of silently ignoring it', () => {
            expect(() => yajs('$<key1 && key2>')).to.throw(/boolean operators/);
        });

        it('still accepts a flat, space-separated drop-keys list end-to-end (must not regress)', () =>
            testJson('{"key1":"a","key2":"b","key3":"c"}', '$<key1 key2>').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([ { key3: 'c' } ]);
            }));
    });

    // Regression tests for GitHub issue #51: a leading UTF-8 byte-order mark
    // (EF BB BF) used to be rejected as a hard parse error
    // ('Unexpected "ï" at position 0'), rather than being tolerated, even
    // though BOM-prefixed JSON/NDJSON is a common artifact of Windows/Excel
    // tooling and some editors. JsonSaxParser now strips a leading BOM
    // before tokenizing - but only when it's genuinely the very first thing
    // in the whole stream, never anywhere else (e.g. a BOM before a later
    // NDJSON document must still be rejected exactly as before).
    describe('leading UTF-8 BOM is stripped (issue #51)', () => {

        it('parses BOM-prefixed input identically to the same JSON without a BOM', () => {
            const json = JSON.stringify({ a: 1, b: [1, 2, 3] });
            return Promise.all([
                testJson(json, '$'),
                // The escaped BOM character (U+FEFF) encodes, via
                // Buffer.from()'s default utf8 encoding, to exactly the
                // same EF BB BF bytes a real BOM-prefixed file would have.
                testJson(String.fromCharCode(0xFEFF) + json, '$'),
            ]).then(([withoutBom, withBom]) => {
                expect(withBom).to.deep.equal(withoutBom);
            });
        });

        it('does not strip a BOM that appears mid-stream, e.g. before a later NDJSON document', () =>
            new Promise<void>((resolve, reject) => {
                const stream = yajs('$');
                stream.
                    on('data', () => undefined).
                    on('end', () => reject(new Error('expected parsing to fail, but the stream ended cleanly'))).
                    on('error', (err: Error) => {
                        try {
                            expect(err.message).to.match(/Unexpected/);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                stream.write(Buffer.from('{"x":1} '));
                stream.write(Buffer.from(String.fromCharCode(0xFEFF) + '{"y":2}'));
                stream.end();
            }));
    });

    // Regression tests for GitHub issue #38: when a selector matches a
    // container AND something independently matched nested inside it
    // (typical of '..'/wildcard selectors), the ancestor's own captured
    // value used to silently lose that whole subtree - or, for an
    // array-of-array shape, the nested match was dropped entirely instead.
    //
    // Root cause (StreamContext.ts's dispatch()): StreamContext suspends
    // whatever dispatcher is currently active whenever a new, independently
    // matched candidate value starts, and only the *active* dispatcher ever
    // receives events - so the suspended ancestor never received the one
    // event (startObject()/startArray()) that would otherwise have attached
    // the nested value under its own currently-pending key/array slot; that
    // event went only to the new, more specific dispatcher instead. Fixed
    // by injecting the completed child's own already-fully-built value
    // directly into the resuming ancestor (via its own onValue(), the exact
    // entry point a live event would have used) at the moment it's popped
    // back to active - O(1) per suspend/resume pair, not O(child subtree
    // size), so this doesn't reintroduce the O(depth^2) dispatcher fan-out
    // issue #8 fixed elsewhere.
    //
    // A second, independent bug also contributed to the array-of-array
    // "dropped" variant specifically: see 02-path.ts's "descendant/wildcard
    // tolerates consecutive arrays" tests for that root cause (a YAJSPath.
    // match() bug, not a StreamContext one) - both fixes are required for
    // case 4 below to pass.
    describe('nested match no longer corrupts or drops its ancestor\'s own value (issue #38)', () => {

        it('does not corrupt the ancestor\'s value when a direct child also independently matches (own repro 1: $..* vs {"top":{"inner":{"a":1}}})', () =>
            testJson('{"top":{"inner":{"a":1}}}', '$..*').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'top', 'inner', 'a' ], value: 1 },
                    { path: [ 'top', 'inner' ], value: { a: 1 } },
                    { path: [ 'top' ], value: { inner: { a: 1 } } },
                ]);
            }));

        it('fixes every ancestor above the innermost match, not just the immediate parent (own repro 2: three nested levels)', () =>
            testJson('{"l1":{"l2":{"l3":{"a":1}}}}', '$..*').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'l1', 'l2', 'l3', 'a' ], value: 1 },
                    { path: [ 'l1', 'l2', 'l3' ], value: { a: 1 } },
                    { path: [ 'l1', 'l2' ], value: { l3: { a: 1 } } },
                    { path: [ 'l1' ], value: { l2: { l3: { a: 1 } } } },
                ]);
            }));

        it('only loses the corrupted span, not sibling keys outside it (own repro 3: $..a vs {"a":{"b":{"a":{"c":1}}}})', () =>
            testJson('{"a":{"b":{"a":{"c":1}}}}', '$..a').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'a', 'b', 'a' ], value: { c: 1 } },
                    { path: [ 'a' ], value: { b: { a: { c: 1 } } } },
                ]);
            }));

        it('does not drop the nested match entirely for an array-of-array shape (own repro 4: $..* vs {"m":[[{"a":1}]]})', () =>
            testJson('{"m":[[{"a":1}]]}', '$..*').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'm', 'a' ], value: 1 },
                    { path: [ 'm' ], value: { a: 1 } },
                    { path: [ 'm' ], value: [ { a: 1 } ] },
                ]);
            }));

        it('chains correctly across three levels of independently-matched nesting (adversarial, deeper than any own repro)', () =>
            testJson('{"m":[[[{"a":1}]]]}', '$..*').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'm', 'a' ], value: 1 },
                    { path: [ 'm' ], value: { a: 1 } },
                    { path: [ 'm' ], value: [ { a: 1 } ] },
                    { path: [ 'm' ], value: [ [ { a: 1 } ] ] },
                ]);
            }));

        it('respects dropKeys applied within each dispatcher\'s own scope when injecting a resumed ancestor\'s value (adversarial: $..*<a>)', () =>
            testJson('{"top":{"inner":{"a":1,"b":2}}}', '$..*<a>').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'top', 'inner', 'a' ], value: 1 },
                    { path: [ 'top', 'inner', 'b' ], value: 2 },
                    { path: [ 'top', 'inner' ], value: { b: 2 } },
                    { path: [ 'top' ], value: { inner: { b: 2 } } },
                ]);
            }));

        it('does not leak across NDJSON document boundaries (adversarial: two documents back to back)', () =>
            testJson('{"a":{"a":1}}\n{"a":{"a":2}}', '$..a').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'a', 'a' ], value: 1 },
                    { path: [ 'a' ], value: { a: 1 } },
                    { path: [ 'a', 'a' ], value: 2 },
                    { path: [ 'a' ], value: { a: 2 } },
                ]);
            }));

        it('still matches a single, non-nested container correctly (must not regress the common case)', () =>
            testJson('{"a":{"b":1,"c":2}}', '$.a').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([ { b: 1, c: 2 } ]);
            }));
    });

    // Regression tests for GitHub issue #39: '$.*..*' silently stopped one
    // hop short of where '$.a..*' and '$..*..*' both correctly reach on the
    // identical document shape - see 02-path.ts's "descendant reaches
    // arbitrary depth past a bare wildcard" tests for the detailed
    // root-cause writeup and YAJSPath.match()-level unit tests; these
    // confirm the fix end-to-end through the real parser and streaming
    // machinery.
    describe('descendant reaches arbitrary depth past a bare wildcard (issue #39)', () => {

        it('reaches two hops past the wildcard, not just one (own repro: $.*..* vs {"a":{"x":1,"b":{"c":2}}})', () =>
            testJson('{"a":{"x":1,"b":{"c":2}}}', '$.*..*').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'a', 'x' ], value: 1 },
                    { path: [ 'a', 'b', 'c' ], value: 2 },
                    { path: [ 'a', 'b' ], value: { c: 2 } },
                ]);
            }));

        it('matches identically via the equivalent named-key form $.a..* (control, must already pass)', () =>
            testJson('{"a":{"x":1,"b":{"c":2}}}', '$.a..*').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'a', 'x' ], value: 1 },
                    { path: [ 'a', 'b', 'c' ], value: 2 },
                    { path: [ 'a', 'b' ], value: { c: 2 } },
                ]);
            }));

        it('matches identically via the equivalent double-descendant form $..*..* (control, must already pass)', () =>
            testJson('{"a":{"x":1,"b":{"c":2}}}', '$..*..*').then((array) => {
                expect(array.map((e) => ({ path: e.path, value: e.value }))).to.deep.equal([
                    { path: [ 'a', 'x' ], value: 1 },
                    { path: [ 'a', 'b', 'c' ], value: 2 },
                    { path: [ 'a', 'b' ], value: { c: 2 } },
                ]);
            }));

        it('does not over-match a position that is genuinely too shallow (adversarial: $.*..* vs a single flat level)', () =>
            testJson('{"a":1,"b":2}', '$.*..*').then((array) => {
                expect(array).to.have.lengthOf(0);
            }));

        it('still reaches through a named array via a bare wildcard (adversarial: $.*..* vs {"arr":[1,2,3]})', () =>
            testJson('{"arr":[1, 2, 3]}', '$.*..*').then((array) => {
                expect(array.map((e) => e.value)).to.deep.equal([ 1, 2, 3 ]);
            }));
    });

    // Regression + performance-guard tests for GitHub issue #34: a '..'-
    // containing path degraded quadratically with document nesting depth,
    // because YAJSPath.match()'s DESCENDANT branch walked the *entire*
    // position stack backward on every single match attempt, and - since a
    // '..' path is never `definite` - a match is attempted at *every* depth
    // as the document streams in: O(depth) work x O(depth) attempts =
    // O(depth^2). Fixed via StreamPosition.nearestAncestorIndex(), an
    // incrementally maintained index answering "nearest ancestor with key K"
    // in O(log depth) instead of rescanning from scratch - see its own and
    // YAJSPath.nearestAncestorIndex()'s field/method comments for the full
    // design.
    //
    // These use a bounded depth (5,000) rather than issue #34's own
    // 20,000-deep measurement, mirroring how issue #8's own regression test
    // (04-error-handling.ts) picked a bound generous enough to clearly
    // distinguish "fixed" from "regressed" without making the test itself
    // slow or flaky. Note the bound below is intentionally more generous
    // than issue #8's: a '..' selector that matches at *every* nesting
    // level (as these do) inherently reports one path array per level, of
    // growing length - the resulting O(depth^2) total *output* size is not
    // itself a bug (it's an unavoidable consequence of how much there is to
    // report), only the extra O(depth^2) *matching* work issue #34
    // describes is.
    describe('descendant matching stays roughly linear with document depth (issue #34)', () => {

        function buildDeepChain(depth: number, key: string): string {
            return `${Array(depth).fill(`{"${key}":`).join('')}1${'}'.repeat(depth)}`;
        }

        it('matches a 5,000-deep chain of the same repeated key in well under the pre-fix time (own repro shape: $..a)', () => {
            const depth = 5000;
            const json = buildDeepChain(depth, 'a');
            const start = Date.now();
            return testJson(json, '$..a').then((array) => {
                const elapsedMs = Date.now() - start;
                expect(array).to.have.lengthOf(depth);
                // Issue #34 measured ~931ms at this exact depth pre-fix, and
                // ~14s at depth 20,000 (quadratic); this fix measures well
                // under 300ms at depth 5,000 locally. A generous upper bound
                // for a slow CI machine - comfortably above the fixed
                // timing (leaving headroom for the inherent O(depth)
                // matches x O(depth) average path length output cost
                // described above) but nowhere near what either the
                // pre-fix flat ~931ms or its quadratic trajectory would
                // produce here, so an accidental revert would still be
                // caught.
                expect(elapsedMs, `took ${elapsedMs}ms`).to.be.lessThan(4000);
            });
        }, 20000);

        it('the underlying ancestor scan itself - not just the combined match+output cost above - stays near-flat with depth, isolated from any output-size effect', () => {
            // '$.nonexistent..a' against a chain of nested "a" keys, not
            // '$..z': the trailing pattern operator is checked *before*
            // match() ever reaches the DESCENDANT branch (see the top-of-
            // stack check at the very start of match()), so a trailing key
            // that never matches anything (like 'z' against an all-"a"
            // chain) short-circuits there on every attempt without ever
            // running the backward scan this test means to isolate -
            // silently measuring almost nothing. 'a' as the trailing key
            // matches at every depth (entering the DESCENDANT branch every
            // time), while 'nonexistent' - the operator *before* the '..',
            // i.e. what the scan actually searches the ancestor chain for -
            // never appears anywhere, forcing every single attempt into a
            // genuine (failing) full-depth search with zero matches, so no
            // path array is ever built either - isolating purely the
            // backward-scan cost issue #34's own root-cause writeup names,
            // the same way issue #8's own StreamContext-level test
            // (08-stream-context.ts) isolates dispatcher bookkeeping from
            // tokenizer overhead.
            function timeScan(depth: number): Promise<number> {
                const json = buildDeepChain(depth, 'a');
                const start = Date.now();
                return testJson(json, '$.nonexistent..a').then((array) => {
                    expect(array).to.have.lengthOf(0);
                    return Date.now() - start;
                });
            }

            return timeScan(1000). // warm up the JIT first
                then(() => timeScan(2000)).
                then((small) => timeScan(20000).then((large) => {
                    // A genuinely near-O(depth) (or better) scan should take
                    // on the order of 10x as long for 10x the depth; the
                    // pre-fix O(depth) *per attempt*, attempted at every one
                    // of O(depth) depths, took on the order of 100x as long.
                    // 30x is comfortably below quadratic and comfortably
                    // above ordinary timing noise (mirrors
                    // 08-stream-context.ts's own issue #8 ratio test).
                    expect(large, `small=${small}ms large=${large}ms`).
                        to.be.lessThan(Math.max(small, 1) * 30);
                }));
        }, 30000);

        it('a non-descendant path is unaffected by the fix (must not regress the common case)', () => {
            const depth = 20000;
            const json = buildDeepChain(depth, 'a');
            const start = Date.now();
            return testJson(json, '$').then((array) => {
                const elapsedMs = Date.now() - start;
                expect(array).to.have.lengthOf(1);
                expect(elapsedMs, `took ${elapsedMs}ms`).to.be.lessThan(3000);
            });
        }, 10000);
    });

    // Regression tests for GitHub issue #44: StreamContext.onMatchListener
    // rebuilt the full match path from scratch (YAJSPath.path()'s O(depth)
    // scan-and-filter over the entire position stack) on *every* successful
    // match, not just descendant ones - so a selector matching at every one
    // of D depths (e.g. issue #34's own '$..a' repro shape) paid O(D) work
    // per match, O(D^2) overall, on top of whatever issue #34's own fix
    // (PR #43) already addressed in the backward-scan mechanism itself.
    // Fixed via an incrementally-maintained segment list in StreamPosition
    // (mSegments/mSegmentBaseline), kept in sync with every position-stack
    // mutation, so path() becomes a single O(k) copy of just the k real
    // segments instead of an O(depth) re-scan of the whole stack.
    //
    // This does NOT change the underlying O(D^2) complexity for this exact
    // pathological shape (every one of D matches still needs its own
    // O(average depth) array - that copy cost is inherent, not redundant
    // work), but removes a large, genuinely wasteful constant factor (the
    // repeated re-filtering of ARRAY/transparent stack levels that never
    // contribute a segment). Independently measured: depth 20,000 dropped
    // from ~11.7s (issue #34's own fix alone) to ~0.8-1.1s - roughly a
    // 10-15x improvement, not a change of complexity class. See issue #44
    // itself and its own linked follow-up discussion for that nuance.
    describe('per-match path materialization stays cheap even when every level matches (issue #44)', () => {

        function buildDeepChain(depth: number, key: string): string {
            return `${Array(depth).fill(`{"${key}":`).join('')}1${'}'.repeat(depth)}`;
        }

        it('matches a 20,000-deep chain of the same repeated key well under the pre-#44-fix time (own repro shape: $..a, combined match+output cost)', () => {
            const depth = 20000;
            const json = buildDeepChain(depth, 'a');
            const start = Date.now();
            return testJson(json, '$..a').then((array) => {
                const elapsedMs = Date.now() - start;
                expect(array).to.have.lengthOf(depth);
                // Pre-#44 (i.e. with only issue #34's backward-scan fix)
                // measured ~11.7s at this depth; post-#44 measures roughly
                // 0.8-1.1s locally, up to ~6.5s observed on a heavily
                // loaded shared machine (load average ~20). A generous
                // upper bound - comfortably below what an accidental
                // revert of #44 (while #34 stays fixed) would produce, and
                // nowhere near what having neither fix would produce -
                // while leaving real headroom above worst-case-observed
                // contention so this doesn't flake under load.
                expect(elapsedMs, `took ${elapsedMs}ms`).to.be.lessThan(9000);
            });
        }, 20000);

        it('still produces a correct, independent path array per match when a key is reused multiple times in the same object, mixed with arrays and pathIncludeArrayIndex (adversarial: exercises the segment-baseline truncate/replace logic directly)', () =>
            testJson(
                '{"list":[{"tag":"first","nested":{"tag":"inner"}},{"tag":"second"}]}',
                '$..tag', true).
            then((array) => {
                expect(array).to.deep.equal([
                    { path: [ 'list', 0, 'tag' ], value: 'first' },
                    { path: [ 'list', 0, 'nested', 'tag' ], value: 'inner' },
                    { path: [ 'list', 1, 'tag' ], value: 'second' },
                ]);
            }));
    });

    // Regression tests for GitHub issue #37: AbstractFilteredOperator.
    // matchFilter() discarded the key-name-equality `matches` boolean
    // whenever a filter expression was attached, so '[<filter>]<key>'
    // matched every sibling key inside a filter-satisfying ancestor instead
    // of just the one literally named <key>. See 02-path.ts for the
    // parser-level unit tests pinning the fix in matchFilter() itself; these
    // confirm it end-to-end through the real yajs() entry point.
    describe('filter does not drop the key-name check (issue #37)', () => {

        it('matches only the named key, not every sibling, inside a filtered ancestor ' +
            '($..[key1]child vs {"key1":{"child":1,"other":2}})', () =>
            testJson('{"key1":{"child":1,"other":2}}', '$..[key1]child').then((array) => {
                expect(array).to.deep.equal([ { path: [ 'key1', 'child' ], value: 1 } ]);
            }));

        it('produces exactly the README\'s documented output for $..[!key1]child ' +
            '(must not regress into spurious extra/duplicate entries)', () =>
            testJson(
                '{"array":[{"key1":{"child":"value1"}},{"key2":{"child":"value2"}}]}',
                '$..[!key1]child').
            then((array) => {
                expect(array).to.deep.equal([
                    { path: [ 'array', 'key2', 'child' ], value: 'value2' },
                ]);
            }));
    });

    // Regression test for GitHub issue #36: matches used to be delivered via
    // stream.emit('data', ...) directly, which completely bypasses `through`'s
    // own queue()/drain() buffering - the only mechanism that actually checks
    // `stream.paused`. That meant a slow/paused downstream consumer (exactly
    // what Node's .pipe() backpressure is supposed to produce) had zero effect
    // on delivery: every match found while parsing a single write() chunk was
    // dumped downstream synchronously and immediately, regardless of how far
    // behind the consumer was - unbounded in-flight lag, bounded only by
    // however many matches happened to land in one upstream chunk. Fixed by
    // routing matches (and end-of-stream) through stream.queue()/push()
    // instead. See yajs.ts.
    describe('stream backpressure (issue #36)', () => {

        it('keeps in-flight lag bounded near the downstream highWaterMark instead of unbounded, when a slow consumer is fed many matches in one chunk', () => {
            const N = 500;
            const HWM = 16;

            // One NDJSON payload delivered as a SINGLE chunk - mirrors a
            // real fs.createReadStream chunk packed with many documents,
            // which is exactly the scenario the issue measured.
            let payload = '';
            for (let i = 0; i < N; i++) {
                payload += JSON.stringify({ id: i }) + '\n';
            }
            const buf = Buffer.from(payload);
            const source = new Readable({
                read() {
                    this.push(buf);
                    this.push(null);
                },
            });

            let emitted = 0;
            let consumed = 0;
            let maxLag = 0;

            const stream = yajs('$');
            stream.on('data', () => {
                emitted++;
                maxLag = Math.max(maxLag, emitted - consumed);
            });

            const sink = new Writable({
                objectMode: true,
                highWaterMark: HWM,
                write(_chunk, _enc, callback) {
                    // Simulate a slow downstream consumer (DB writer, rate-limited
                    // API client, etc.) - defer the callback so the sink's own
                    // write buffer, and therefore Node's backpressure signal
                    // back to `stream`, actually has time to build up.
                    setImmediate(() => {
                        consumed++;
                        callback();
                    });
                },
            });

            return new Promise<void>((resolve, reject) => {
                source.pipe(stream).pipe(sink);
                stream.on('error', reject);
                sink.on('error', reject);
                sink.on('finish', () => {
                    try {
                        expect(emitted).to.equal(N);
                        expect(consumed).to.equal(N);
                        // Bounded near the consumer's own highWaterMark, not
                        // anywhere near N (unbounded) as it was before the fix.
                        expect(maxLag).to.be.at.most(HWM * 2);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        });
    });
    // Regression tests for GitHub issue #61: writing a plain JS string (not
    // a Buffer) to the stream - either directly via .write()/.end() or via
    // .pipe() from a Readable in string/encoded mode - used to fail with a
    // misleading, content-independent NUL-byte error instead of parsing
    // correctly. JsonSaxParser.parse() does raw numeric byte indexing
    // (buffer[i] compared against byte constants), which only makes sense
    // for a Buffer; `through`'s own write() does no string-to-Buffer
    // coercion, so a string chunk silently corrupted every comparison
    // instead of failing loudly - every buffer[i] read a one-character
    // string, every numeric comparison failed, and parsing fell through to
    // charError(), where Number(char) is NaN and
    // String.fromCharCode(NaN) produces a NUL character, regardless of what
    // the actual input was. Fixed in yajs.ts by converting a string chunk to
    // a Buffer (UTF-8, matching JSON's own required encoding) at the one
    // point both .write(str) and .pipe() funnel through - see yajs.ts's own
    // comment on the through() write callback for the full reasoning,
    // including why the fix belongs there and not inside JsonSaxParser
    // itself.
    describe('string (non-Buffer) input to write()/pipe() (issue #61)', () => {

        it('parses a plain string written via .write(), identically to the equivalent Buffer (issue\'s own repro)', () => {
            const json = JSON.stringify({ a: 1 });
            return Promise.all([
                testJson(json, '$'),
                testJsonAsString(json, '$'),
            ]).then(([viaBuffer, viaString]) => {
                expect(viaString.map((e) => e.value)).to.deep.equal(viaBuffer.map((e) => e.value));
                expect(viaString[0].value).to.deep.equal({ a: 1 });
            });
        });

        it('parses a plain string piped from a Readable in string/encoded mode (issue\'s second repro)', () =>
            new Promise<void>((resolve, reject) => {
                const result: any[] = [];
                const stream = yajs('$.a');
                stream.
                    on('data', (data: any) => result.push(data)).
                    on('end', () => {
                        try {
                            expect(result).to.deep.equal([{ path: ['a'], value: 1 }]);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }).
                    on('error', reject);
                const src = Readable.from([JSON.stringify({ a: 1 })]);
                src.setEncoding('utf8');
                src.pipe(stream);
            }));

        it('correctly UTF-8 encodes non-ASCII content written as a plain string, not just ASCII', () => {
            const json = JSON.stringify({ a: 'héllo 世界' });
            return testJsonAsString(json, '$.a').then((array) => {
                expect(array).to.have.lengthOf(1);
                expect(array[0].value).to.equal('héllo 世界');
            });
        });

        it('leaves ordinary Buffer input completely unaffected (must not regress the documented, existing usage)', () => {
            const json = JSON.stringify({ a: 1, b: [1, 2, 3] });
            return testJson(json, '$').then((array) => {
                expect(array).to.have.lengthOf(1);
                expect(array[0].value).to.deep.equal({ a: 1, b: [1, 2, 3] });
            });
        });

        it('still produces identical results when a document\'s string content arrives split across ' +
            'multiple string .write() calls at every character boundary (mirrors 05-chunk-boundary.ts\'s ' +
            'Buffer-based coverage, for the new string-conversion layer)', async () => {
            const json = JSON.stringify({ a: 'héllo 世界' });
            const baseline = await testJsonAsString(json, '$');
            expect(baseline).to.have.lengthOf(1);

            for (let i = 1; i < json.length; i++) {
                const actual = await testJsonAsStringChunks([json.slice(0, i), json.slice(i)], '$');
                expect(actual, `split at char offset ${i}/${json.length}`).to.deep.equal(baseline);
            }
        });
    });
});

function test(json: string, path: string, pathIncludeArrayIndex = false): Promise<any[]> {
    const source = createReadStream(`${__dirname}/stream-tests/${json}.json`);
    return new Promise<any[]>((resolve, reject) => {
        const result: any[] = [];
        source.
            pipe(yajs(path, { pathIncludeArrayIndex })).
            on('data', (data: any) => result.push(data)).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
    });
}

function testJson(json: string, path: string, pathIncludeArrayIndex = false): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
        const result: any[] = [];
        const stream = yajs(path, { pathIncludeArrayIndex });
        stream.
            on('data', (data: any) => result.push(data)).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
        stream.write(Buffer.from(json));
        stream.end();
    });
}

// Same as testJson() above, but writes the JSON document as a plain JS
// string (issue #61) instead of Buffer.from(json) - exercises the
// string-to-Buffer conversion added in yajs.ts.
function testJsonAsString(json: string, path: string, pathIncludeArrayIndex = false): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
        const result: any[] = [];
        const stream = yajs(path, { pathIncludeArrayIndex });
        stream.
            on('data', (data: any) => result.push(data)).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
        stream.write(json);
        stream.end();
    });
}

// Same as testJsonAsString() above, but delivers the document as several
// separate plain-string .write() calls instead of one - mirrors
// 05-chunk-boundary.ts's chunked-Buffer coverage, for string input.
function testJsonAsStringChunks(chunks: string[], path: string): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
        const result: any[] = [];
        const stream = yajs(path);
        stream.
            on('data', (data: any) => result.push(data)).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
        chunks.forEach((chunk) => stream.write(chunk));
        stream.end();
    });
}

function toString(json: string): Promise<string> {
    const source = createReadStream(`${__dirname}/stream-tests/${json}.json`);
    return new Promise<string>((resolve, reject) => {
        let result = '';
        source.
            on('data', (data: any) => result += data.toString()).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
    });
}
