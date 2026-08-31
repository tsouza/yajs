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

    // Regression tests for GitHub issue #26: buildArgsExpression()/
    // extractKeys() only walked children that were themselves a
    // FilterExpressionTermContext, which misses `ctx._expr` (a
    // FilterExpressionContext) entirely - so a parenthesized group
    // `LP filterExpression RP` was silently dropped by extractKeys() and
    // compiled to a bare, always-invalid `()` by buildArgsExpression().
    describe('parenthesized groups (issue #26)', () => {

        it('extracts keys and builds a valid expression for a simple parenthesized group', () => {
            const parser = createParser('$.[(a && b)]x');
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(extractKeys(filter.filterExpression())).to.deep.equal(['a', 'b']);
            expect(buildArgsExpression(filter.filterExpression())).
                to.equal('(args["a"]&&args["b"])');
        });

        it('extracts keys and builds a valid expression for parenthesized groups combined with && and ||', () => {
            const parser = createParser('$.[(a && b) || (!c && d)]x');
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(extractKeys(filter.filterExpression())).to.deep.equal(['a', 'b', 'c', 'd']);
            expect(buildArgsExpression(filter.filterExpression())).
                to.equal('(args["a"]&&args["b"])||(!(args["c"])&&args["d"])');
        });

        it('extracts keys and builds a valid expression for a nested parenthesized group', () => {
            const parser = createParser('$.[((a || b) && c)]x');
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(extractKeys(filter.filterExpression())).to.deep.equal(['a', 'b', 'c']);
            expect(buildArgsExpression(filter.filterExpression())).
                to.equal('((args["a"]||args["b"])&&args["c"])');
        });
    });

    // Regression tests for GitHub issue #26: the grammar
    // (`filterExpression : filterExpressionTerm+`) allows any number of bare
    // key terms with no separator between them (`[a b]`, `{prop1 prop2}` -
    // the README's own documented "keys filter" style), but
    // doBuildArgsExpression() only inserted a connector when the *current*
    // term itself carried an explicit `_op` - an un-prefixed second/third
    // term just concatenated onto the previous one, producing invalid JS
    // (`args["a"]args["b"]`). Adjacent bare terms with no explicit connector
    // are now joined with an implicit `||`, matching the documented
    // OR/"keys filter" semantics.
    describe('adjacent bare-key lists with no explicit operator (issue #26)', () => {

        it('joins two adjacent bare keys in a [...] filter with an implicit ||', () => {
            const parser = createParser('$.[a b]x');
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(extractKeys(filter.filterExpression())).to.deep.equal(['a', 'b']);
            expect(buildArgsExpression(filter.filterExpression())).
                to.equal('args["a"]||args["b"]');
        });

        it('joins three or more adjacent bare keys in a [...] filter with an implicit ||', () => {
            const parser = createParser('$.[a b c]x');
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(extractKeys(filter.filterExpression())).to.deep.equal(['a', 'b', 'c']);
            expect(buildArgsExpression(filter.filterExpression())).
                to.equal('args["a"]||args["b"]||args["c"]');
        });

        it('joins adjacent bare keys in a {...} projection with an implicit ||', () => {
            const parser = createParser('$.test{field1 field2 field3}');
            const path = parser.path();
            const projection = path.pathLeaf().actionProject();

            expect(extractKeys(projection.filterExpression())).
                to.deep.equal(['field1', 'field2', 'field3']);
            expect(buildArgsExpression(projection.filterExpression())).
                to.equal('args["field1"]||args["field2"]||args["field3"]');
        });
    });

    // Regression test for GitHub issue #26: `op=(AND | OR) term=...` doesn't
    // require a preceding term, so a leading bare `&&`/`||` with no
    // left-hand operand (e.g. `[&&x]`) parses successfully but has nothing
    // to attach the operator to. buildArgsExpression() now rejects this with
    // a clean, catchable Error (consistent with how issues #18/#19 made
    // other malformed selectors fail cleanly) instead of emitting invalid JS
    // (`&&args["x"]`) that would only surface as a confusing raw
    // vm.runInContext SyntaxError.
    describe('leading bare operator with no left operand (issue #26)', () => {

        it('throws a clean Error instead of emitting invalid JS for a leading &&', () => {
            const parser = createParser('$.[&&x]y');
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(() => buildArgsExpression(filter.filterExpression())).to.throw(
                /has no left-hand operand/);
        });

        it('throws a clean Error instead of emitting invalid JS for a leading ||', () => {
            const parser = createParser('$.[||x]y');
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(() => buildArgsExpression(filter.filterExpression())).to.throw(
                /has no left-hand operand/);
        });
    });
});

function createParser(path: string): YAJSParser {
    const inputStream = new ANTLRInputStream(path);
    const lexer = new YAJSLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    return new YAJSParser(tokenStream);
}
