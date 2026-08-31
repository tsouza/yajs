import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';

import { buildArgsExpression, extractKeys } from '../main/lib/path/parser/utils';
import { YAJSLexer } from '../main/lib/path/parser/YAJSLexer';
import { YAJSParser } from '../main/lib/path/parser/YAJSParser';

import { describe, expect, it } from 'vitest';

describe('path parser', () => {

    it('should parse root', () => {
        const parser = createParser('$');
        const path = parser.path();

        expect(path.ROOT()).to.exist;
    });

    it('should parse child', () => {
        const parser = createParser('$.test');
        const path = parser.path();

        expect(path.pathStep()).to.have.lengthOf(1);
        expect(path.pathStep()[0].DOT()).to.exist;
        expect(path.pathStep()[0].actionField()).to.exist;
        expect(path.pathStep()[0].actionField()._key.text).to.equal('test');
    });

    it('should parse child filtered', () => {
        const parser = createParser('$.[test.field1 && .field2]test');
        const path = parser.path();

        expect(path.pathStep()).to.have.lengthOf(1);
        expect(path.pathStep()[0].actionFilter()).to.exist;
        const filter = path.pathStep()[0].actionFilter();
        if (filter) {
            expect(filter.filterExpression().text).to.equal('test.field1&&.field2');
            const keys = extractKeys(filter.filterExpression());
            expect(keys).to.deep.equal(['test.field1', '.field2']);
            const argsExpr = buildArgsExpression(filter.filterExpression());
            // Double-quoted (JSON.stringify) rather than manually
            // single-quoted, since issue #17 - a key containing a single
            // quote used to break out of a naive `'${key}'` string literal
            // in this generated expression, crashing vm.runInContext with a
            // SyntaxError instead of being treated as an ordinary key name.
            expect(argsExpr).to.be.equal('args["test.field1"]&&args[".field2"]');
        }
    });

    it('should parse projection keys', () => {
        const parser = createParser('$.test{field1 && field2}');
        const path = parser.path();

        expect(path.pathLeaf()).to.exist;
        expect(path.pathLeaf().actionProject()).to.exist;
        const projection = path.pathLeaf().actionProject();
        if (projection) {
            expect(projection.filterExpression().text).to.equal('field1&&field2');
            const keys = extractKeys(projection.filterExpression());
            expect(keys).to.deep.equal(['field1', 'field2']);
        }
    });

    // Regression tests for issue #26: buildArgsExpression()/extractKeys()
    // naively concatenated tokens while walking the parse tree, which broke
    // (or silently dropped keys) for several grammar-legal patterns beyond
    // the simple "chain of &&/||-prefixed terms" case already covered
    // above.
    describe('parenthesized groups, bare adjacency, and leading operators ' +
        '(issue #26)', () => {

        it('should recurse into a parenthesized group instead of dropping ' +
            'its keys and emitting empty, invalid `()`', () => {
            const parser = createParser('$.[(a && b) || (!c && d)]x');
            const path = parser.path();
            const filter = path.pathStep()[0].actionFilter();
            if (filter) {
                const keys = extractKeys(filter.filterExpression());
                expect(keys).to.deep.equal(['a', 'b', 'c', 'd']);
                const argsExpr = buildArgsExpression(filter.filterExpression());
                expect(argsExpr).to.equal(
                    '(args["a"]&&args["b"])||(!args["c"]&&args["d"])');
            }
        });

        it('should default to `&&` between adjacent terms with no ' +
            'explicit operator (the README\'s "keys filter" style: ' +
            '`[a b]`, `{prop1 prop2}`)', () => {
            const parser = createParser('$.test{field1 field2}');
            const path = parser.path();
            const projection = path.pathLeaf().actionProject();
            if (projection) {
                const keys = extractKeys(projection.filterExpression());
                expect(keys).to.deep.equal(['field1', 'field2']);
                const argsExpr = buildArgsExpression(projection.filterExpression());
                expect(argsExpr).to.equal('args["field1"]&&args["field2"]');
            }
        });

        it('should default to `&&` between an unprefixed term and a ' +
            'following bare NOT term (`[a !b]`)', () => {
            const parser = createParser('$.[a !b]x');
            const path = parser.path();
            const filter = path.pathStep()[0].actionFilter();
            if (filter) {
                const argsExpr = buildArgsExpression(filter.filterExpression());
                expect(argsExpr).to.equal('args["a"]&&!args["b"]');
            }
        });

        it('should drop a leading `&&`/`||` that has no left operand ' +
            '(`[&&x]`)', () => {
            const parser = createParser('$.[&&x]y');
            const path = parser.path();
            const filter = path.pathStep()[0].actionFilter();
            if (filter) {
                const argsExpr = buildArgsExpression(filter.filterExpression());
                expect(argsExpr).to.equal('args["x"]');
            }
        });
    });
});

function createParser(path: string): YAJSParser {
    const inputStream = new ANTLRInputStream(path);
    const lexer = new YAJSLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    return new YAJSParser(tokenStream);
}
