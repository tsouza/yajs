import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts';

import { buildArgsExpression, containsRegexTerm, extractKeys } from '../main/lib/path/parser/utils';
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

    // Regression tests for GitHub issue #35: extractKeys()/buildArgsExpression()
    // (and their internal doExtractKeys()/doExtractKeysFromExpression()/
    // renderExpression()/renderTerm() helpers) walked the filterExpression/
    // filterExpressionTerm tree via plain JS recursion - one call frame per
    // level of paren nesting - which overflowed the JS call stack (uncaught
    // RangeError) at a nesting depth of roughly 2,000 on this machine, LOWER
    // than the depth the ANTLR-generated parser itself can already build a
    // tree for (roughly 4,000-5,000 on this machine) - making this walk the
    // crash's actual weakest link. Both walks now use an explicit stack
    // instead of the JS call stack (see utils.ts), so nesting depth is no
    // longer bounded by it.
    describe('deeply nested parenthesized groups (issue #35)', () => {

        it('correctly extracts keys and builds an expression through a few hundred levels of redundant nesting', () => {
            const depth = 300;
            const parser = createParser(`$.[${'('.repeat(depth)}key1${')'.repeat(depth)}]x`);
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(extractKeys(filter.filterExpression())).to.deep.equal(['key1']);
            // A chain of single-term parenthesized groups is semantically
            // transparent (see utils.ts's COMBINE_TRANSPARENT_GROUP) - no
            // real parens are needed in the compiled expression no matter
            // how many redundant levels of grouping the selector wrote,
            // since a lone term never needs disambiguating from a
            // surrounding operator. This also keeps the later
            // `new vm.Script(...)` compile step (in ScriptFilterHelper) from
            // having to parse real nested parens matching the selector's
            // nesting depth - V8's own JS-source parser is separately
            // recursive and was found to overflow at a similarly low depth,
            // so eliminating our own walk's recursion alone was not
            // sufficient to fix issue #35's reported crash end-to-end.
            expect(buildArgsExpression(filter.filterExpression())).to.equal('args["key1"]');
        });

        it('does not overflow the call stack far past the pre-fix ~2,000-level ceiling', () => {
            // 2,000 is past the pre-fix ~2,000-level ceiling of this walk
            // specifically (measured on the main thread; under a
            // worker-thread test runner like this one, V8's default stack is
            // considerably smaller, so both that pre-fix ceiling and the
            // ANTLR-generated parser's own separate, third-party nesting
            // ceiling for just building a parse tree - confirmed empirically
            // to sit at ~3,000 in this test runner, versus ~4,000-5,000 on
            // the main thread - sit lower here too). This depth keeps
            // comfortable margin below that other, out-of-scope ceiling
            // while still isolating and exercising only the walk this issue
            // is actually about.
            const depth = 2000;
            const parser = createParser(`$.[${'('.repeat(depth)}key1${')'.repeat(depth)}]x`);
            const filter = parser.path().pathStep()[0].actionFilter();

            expect(() => extractKeys(filter.filterExpression())).to.not.throw();
            expect(extractKeys(filter.filterExpression())).to.deep.equal(['key1']);
            expect(buildArgsExpression(filter.filterExpression())).to.equal('args["key1"]');
        });
    });

    // Unit tests for GitHub issue #96's regex filter primitive at the
    // parser/compiler level (extractKeys()/buildArgsExpression()/
    // containsRegexTerm()) - end-to-end matching behavior is covered in
    // 03-yajs.ts, and the project+drop-keys combination gate it unlocks is
    // covered in 02-path.ts.
    describe('regex filter primitive (issue #96)', () => {

        it('extracts a bare regex term\'s full delimited text as its "key"', () => {
            const parser = createParser('$.test{/^key\\d+$/}');
            const projection = parser.path().pathLeaf().actionProject();
            expect(extractKeys(projection.filterExpression())).to.deep.equal(['/^key\\d+$/']);
        });

        it('renders a regex term identically to a bare key - an args[...] lookup keyed by its own raw text', () => {
            const parser = createParser('$.test{/^key\\d+$/}');
            const projection = parser.path().pathLeaf().actionProject();
            expect(buildArgsExpression(projection.filterExpression())).to.equal('args["/^key\\\\d+$/"]');
        });

        it('composes with bare keys and boolean operators exactly like any other primitive', () => {
            const parser = createParser('$.test{foo && /^key\\d+$/}');
            const projection = parser.path().pathLeaf().actionProject();
            expect(extractKeys(projection.filterExpression())).to.deep.equal(['foo', '/^key\\d+$/']);
            expect(buildArgsExpression(projection.filterExpression())).
                to.equal('args["foo"]&&args["/^key\\\\d+$/"]');
        });

        it('rejects an over-long regex pattern with a clean, catchable error, not a raw one from deep inside RegExp/vm', () => {
            const pattern = 'a'.repeat(201);
            const parser = createParser(`$.test{/${pattern}/}`);
            const projection = parser.path().pathLeaf().actionProject();
            expect(() => extractKeys(projection.filterExpression())).to.throw(/maximum allowed length/);
        });

        it('rejects invalid regex syntax with a clean, catchable error', () => {
            const parser = createParser('$.test{/[/}');
            const projection = parser.path().pathLeaf().actionProject();
            expect(() => extractKeys(projection.filterExpression())).to.throw(/Invalid regex filter pattern/);
        });

        it('containsRegexTerm() reports true only when a regex term is actually present', () => {
            const withRegex = createParser('$.test{foo && /bar/}').path().pathLeaf().actionProject();
            const withoutRegex = createParser('$.test{foo && bar}').path().pathLeaf().actionProject();
            expect(containsRegexTerm(withRegex.filterExpression())).to.be.true;
            expect(containsRegexTerm(withoutRegex.filterExpression())).to.be.false;
        });

        it('containsRegexTerm() finds a regex term nested inside parens/NOT', () => {
            const nested = createParser('$.test{!(foo || /bar/)}').path().pathLeaf().actionProject();
            expect(containsRegexTerm(nested.filterExpression())).to.be.true;
        });
    });
});

function createParser(path: string): YAJSParser {
    const inputStream = new ANTLRInputStream(path);
    const lexer = new YAJSLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    return new YAJSParser(tokenStream);
}
