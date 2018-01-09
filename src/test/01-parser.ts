/* tslint-env mocha */

import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';

import { extractKeys } from '../main/lib/path/parser/utils';
import { YAJSLexer } from '../main/lib/path/parser/YAJSLexer';
import { YAJSParser } from '../main/lib/path/parser/YAJSParser';

import { expect } from 'chai';

describe('path parser', () => {

    it('should parse root', () => {
        const parser = createParser('$');
        const path = parser.path();

        // tslint:disable-next-line:no-unused-expression
        expect(path.ROOT()).to.exist;
    });

    it('should parse child', () => {
        const parser = createParser('$.test');
        const path = parser.path();

        expect(path.pathStep()).to.have.lengthOf(1);
        // tslint:disable-next-line:no-unused-expression
        expect(path.pathStep()[0].DOT()).to.exist;
        // tslint:disable-next-line:no-unused-expression
        expect(path.pathStep()[0].actionField()).to.exist;
        expect(path.pathStep()[0].actionField()._key.text).to.equal('test');
    });

    it('should parse child filtered', () => {
        const parser = createParser('$.[field1 && field2]test');
        const path = parser.path();

        expect(path.pathStep()).to.have.lengthOf(1);
        // tslint:disable-next-line:no-unused-expression
        expect(path.pathStep()[0].actionFilter()).to.exist;
        const filter = path.pathStep()[0].actionFilter();
        if (filter) {
            expect(filter.filterExpression().text).to.equal('field1&&field2');
            const keys = extractKeys(filter.filterExpression());
            expect(keys).to.deep.equal(['field1', 'field2']);
        }
    });

    it('should parse projection keys', () => {
        const parser = createParser('$.test{field1 && field2}');
        const path = parser.path();

        // tslint:disable-next-line:no-unused-expression
        expect(path.actionProject()).to.exist;
        const projection = path.actionProject();
        if (projection) {
            expect(projection.filterExpression().text).to.equal('field1&&field2');
            const keys = extractKeys(projection.filterExpression());
            expect(keys).to.deep.equal(['field1', 'field2']);
        }
    });
});

function createParser(path: string): YAJSParser {
    const inputStream = new ANTLRInputStream(path);
    const lexer = new YAJSLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    return new YAJSParser(tokenStream);
}
