
import { createReadStream } from 'fs';
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

    // Regression tests for issue #26: buildArgsExpression()/extractKeys()
    // generated invalid JS (or dropped keys) for parenthesized groups,
    // adjacent un-glued terms, and leading operators - grammar-legal
    // patterns reachable via normal selector syntax. Previously this either
    // crashed synchronously out of yajs()/YAJSPath.parse() or, for a
    // filter/project step reached only while a document was streaming,
    // crashed the process (direct .write()) or failed completely silently
    // (piped input).
    describe('filter/project expression codegen (issue #26)', () => {

        it('should not throw and should correctly apply a parenthesized ' +
            'boolean group in a project expression (issue\'s own repro, ' +
            '`(a && b) || (!c && d)`)', () =>
            testJson(
                '[{"a":1,"b":1,"tag":"ab"},' +
                '{"d":1,"tag":"d-only-no-c"},' +
                '{"c":1,"d":1,"tag":"cd"},' +
                '{"a":1,"tag":"a-only"},' +
                '{"b":1,"c":1,"tag":"b-and-c"}]',
                '$.*{(a && b) || (!c && d)}').
                then((array) => {
                    // Neither 'cd' (c&&d present, but !c makes that clause
                    // false, and a/b are absent) nor 'a-only' (a present but
                    // not b, so a&&b is false; c/d both absent, so !c&&d is
                    // also false) nor 'b-and-c' (same shape as 'a-only') pass
                    // either clause of the OR.
                    expect(array.map((e) => e.value.tag)).to.deep.equal(
                        ['ab', 'd-only-no-c']);
                }));

        it('should not throw and should correctly apply a parenthesized ' +
            'boolean group used as a path filter, which checks ancestor ' +
            'keys on the way down to the matched field (previously ' +
            'YAJSPath.parse() itself threw `SyntaxError: Unexpected ' +
            'token \')\'`)', () =>
            Promise.all([
                // "a" and "b" are both ancestors of "x" (nested a -> b -> x),
                // satisfying the `(a && b)` clause.
                testJson('{"a":{"b":{"x":"matches-via-a-and-b"}}}',
                    '$..[(a && b) || (!c && d)]x'),
                // "c" is an ancestor of "x" and "d" isn't, so `!c && d` is
                // false; "a"/"b" are absent, so `a && b` is false too.
                testJson('{"c":{"x":"does-not-match"}}',
                    '$..[(a && b) || (!c && d)]x'),
            ]).then(([matches, noMatch]) => {
                expect(matches.map((e) => e.value)).to.deep.equal(['matches-via-a-and-b']);
                expect(noMatch).to.have.lengthOf(0);
            }));

        it('should default adjacent, unglued project keys to `&&` ' +
            '(the README\'s "keys filter" style: `{prop1 prop2}`)', () =>
            testJson(
                '[{"prop1":"v1","prop2":"v2","tag":"both"},' +
                '{"prop1":"v1","tag":"only-prop1"}]',
                '$.*{prop1 prop2}').
                then((array) => {
                    expect(array.map((e) => e.value.tag)).to.deep.equal(['both']);
                }));

        it('should not crash the process/stream on adjacent, unglued ' +
            'filter keys reached mid-stream (issue\'s own repro, ' +
            '`{prop1 prop2}` via `.write()`)', () =>
            testJson('{"foo":{"prop1":"v1","prop2":"v2"}}', '$.foo{prop1 prop2}').
                then((array) => {
                    expect(array).to.have.lengthOf(1);
                    expect(array[0].value).to.deep.equal({ prop1: 'v1', prop2: 'v2' });
                }));

        it('should drop a leading bare `&&` that has no left operand ' +
            '(issue\'s own repro shape, `$.[&&x]y` - previously this ' +
            'threw synchronously out of yajs() itself: `SyntaxError: ' +
            'Unexpected token \'&&\'`), and still filter correctly once ' +
            'the operator is dropped', () =>
            // "a" is an ancestor of "x" (nested a -> x); with the leading
            // `&&` dropped this collapses to the plain `[a]` filter, so it
            // should behave identically to that selector.
            Promise.all([
                testJson('{"a":{"x":"has-ancestor-a"}}', '$..[&&a]x'),
                testJson('{"a":{"x":"has-ancestor-a"}}', '$..[a]x'),
                testJson('{"b":{"x":"no-ancestor-a"}}', '$..[&&a]x'),
            ]).then(([leadingOp, plain, noMatch]) => {
                expect(leadingOp.map((e) => e.value)).to.deep.equal(['has-ancestor-a']);
                expect(leadingOp).to.deep.equal(plain);
                expect(noMatch).to.have.lengthOf(0);
            }));
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
