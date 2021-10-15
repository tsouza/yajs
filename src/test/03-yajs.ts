/* tslint-env mocha */

import { all } from 'bluebird';
import { expect } from 'chai';
import { createReadStream } from 'fs';

import yajs from '../main/yajs';

describe('yajs', () => {

    it('should parse simple json', () =>
        all([test('simple', '$').then((r) => r[0]),
            toString('simple').then((j) => JSON.parse(j))]).
            spread((actual: any, expected: any) => {
                // tslint:disable-next-line:no-unused-expression
                expect(actual.path).to.be.empty;
                expect(actual.value).to.be.deep.equal(expected);
            }));

    it('should parse triple double quotes json', () =>
        test('triple-dquotes', '$').then((r) => r[0]).
        then((actual: any) => {
            // tslint:disable-next-line:no-unused-expression
            expect(actual.path).to.be.empty;
            expect(actual.value).to.be.deep.equal({
                test1: '',
                test2: '\n    "test" \\"test\\" ""\n',
                test3: '"',
                test4: 'test " test',
            });
    }));

    it('should parse ndjson', () =>
        all([test('ndjson', '$'),
            toString('ndjson').then((j) => j.
                split('\n').filter((l) => l.length).
                map((l) => JSON.parse(l)))]).
            spread((actual: any, expected: any[]) => {
                expect(actual).to.lengthOf(4);
                actual.forEach((entry: any, idx: number) => {
                    // tslint:disable-next-line:no-unused-expression
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
	it('should return an nothing', () =>
	   test('number', '$', false).
		   then((array) => expect(array).to.be.lengthOf(0)));
	it('should catch parsing error #1', () =>
		 test('error-01', '$', false).
			 then(() => Promise.reject(new Error('An error is the attempted behavior'))).
			 catch((e) => { 
			 expect(e).to.be.an('error');
			 expect(e.message).to.be.equal('Unexpected "#" at position 0 in state START');
			 return Promise.resolve();
		 }));
	it.skip('should catch parsing error #2', () =>
		 test('error-02', '$', false).
			 then(() => Promise.reject(new Error('An error is the attempted behavior'))).
			 catch((e) => { 
			 expect(e).to.be.an('error');
			 expect(e.message).to.be.equal('Unexpected "a" at position 1 in state START');
			 return Promise.resolve();
		 }));
	it('should catch parsing error #3', () =>
		 test('error-03', '$', false).
			 then(() => Promise.reject(new Error('An error is the attempted behavior'))).
			 catch((e) => { 
			 expect(e).to.be.an('error');
			 expect(e.message).to.be.equal('Unexpected "a" at position 5 in state START');
			 return Promise.resolve();
		 }));
	it('should catch parsing error #4', () =>
		 test('error-04', '$', false).
			 then(() => Promise.reject(new Error('An error is the attempted behavior'))).
			 catch((e) => { 
			 expect(e).to.be.an('error');
			 expect(e.message).to.be.equal('Unexpected "." at position 7 in state NUMBER4');
			 return Promise.resolve();
		 }));

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
