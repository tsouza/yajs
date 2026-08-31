
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
