import { describe, expect, it } from 'vitest';
import { ArrayIndex } from '../main/lib/path/operator/ArrayIndex';
import { YAJSPath } from '../main/lib/path/YAJSPath';

describe('path match', () => {

    describe('object', () => {
        it('should match on root', () => {
            const root1 = new YAJSPath.Builder().build();
            const root2 = new YAJSPath.Builder().build();

            expect(root1.match(root2)).to.equal(true);
            expect(root2.match(root1)).to.equal(true);
        });

        it('should match on wildcard', () => {
            const prop1 = new YAJSPath.Builder().
                addChild('prop1').
                build();

            const wildcard = new YAJSPath.Builder().
                addWildcard().
                build();

            expect(wildcard.match(prop1)).to.equal(true);
            expect(prop1.match(wildcard)).to.equal(false);
        });

        it('should match on simple property', () => {
            const path1 = new YAJSPath.Builder().
                addChild('prop1').
                build();

            const path2 = new YAJSPath.Builder().
                addChild('prop1').
                build();

            expect(path1.match(path2)).to.equal(true);
            expect(path2.match(path1)).to.equal(true);
        });

        it('should match on descendant', () => {
            const path1 = new YAJSPath.Builder().
                addChild('prop1').
                addChild('prop2').
                addChild('prop3').
                build();

            const descendant = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3').
                build();

            expect(descendant.match(path1)).to.equal(true);
        });

        it('should match on descendant (filtered)', () => {
            const path1 = new YAJSPath.Builder().
                addChild('prop1').
                addChild('prop2').
                addChild('prop3').
                build();

            const descendant1 = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3', 'prop1', [ 'prop1' ]).
                build();

            const descendant2 = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3', 'prop5', [ 'prop5' ]).
                build();

            const descendant3 = new YAJSPath.Builder().
                addDescendant().
                addChild('prop3', 'args[\'prop1\'] && args[\'prop2\']',
                    [ 'prop1', 'prop2' ]).
                build();

            expect(descendant1.match(path1)).to.equal(true);
            expect(descendant2.match(path1)).to.equal(false);
            expect(descendant3.match(path1)).to.equal(true);
        });
    });

    // Regression tests for GitHub issue #20: a bare ArrayIndex position
    // (built here directly via push(), the same way StreamPosition builds
    // it while streaming) sitting immediately under Root used to make
    // '$.*' incorrectly fail to match, even though ArrayIndex itself always
    // matches (see ArrayIndex.match()) and Wildcard also always matches
    // unfiltered - the root cause was in YAJSPath.match()'s array-
    // transparency retry, not either operator's own match() logic. These
    // pin the fix at the YAJSPath.match() level, independent of the
    // parser/stream machinery already covered end-to-end in 03-yajs.ts.
    describe('array (issue #20)', () => {
        it('should match a bare top-level array position on wildcard', () => {
            const wildcard = new YAJSPath.Builder().
                addWildcard().
                build();

            const arrayPosition = new YAJSPath.Builder().build();
            arrayPosition.push(new ArrayIndex());

            expect(wildcard.match(arrayPosition)).to.equal(true);
        });

        it('should match a bare top-level array position on plain root (must not regress)', () => {
            const root = new YAJSPath.Builder().build();

            const arrayPosition = new YAJSPath.Builder().build();
            arrayPosition.push(new ArrayIndex());

            expect(root.match(arrayPosition)).to.equal(true);
        });

        it('should match a named key\'s array position on that key + wildcard', () => {
            const pattern = new YAJSPath.Builder().
                addChild('a').
                addWildcard().
                build();

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
        });

        it('should not match a different named key through an array position (wildcard\'s permissive match must not mask a key mismatch)', () => {
            const pattern = new YAJSPath.Builder().
                addChild('b').
                build();

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(false);
        });
    });

    describe('string', () => {
        it('should match on root', () => {
            const root1 = YAJSPath.parse('$');
            const root2 = YAJSPath.parse('$');

            expect(root1.match(root2)).to.equal(true);
            expect(root2.match(root1)).to.equal(true);
        });

        it('should match on wildcard', () => {
            const prop1 = YAJSPath.parse('$.prop1');
            const wildcard = YAJSPath.parse('$.*');

            expect(wildcard.match(prop1)).to.equal(true);
            expect(prop1.match(wildcard)).to.equal(false);
        });

        it('should match on simple property', () => {
            const path1 = YAJSPath.parse('$.prop1');
            const path2 = YAJSPath.parse('$.prop1');

            expect(path1.match(path2)).to.equal(true);
            expect(path2.match(path1)).to.equal(true);
        });

        it('should match on descendant', () => {
            const path1 = YAJSPath.parse('$.prop1.prop2.prop3');
            const descendant = YAJSPath.parse('$..prop3');

            expect(descendant.match(path1)).to.equal(true);
        });

        it('should match on descendant (filtered)', () => {
            const path1 = YAJSPath.parse('$.prop1.prop2.prop3');

            const descendant1 = YAJSPath.parse('$..[prop1]prop3');
            const descendant2 = YAJSPath.parse('$..[prop5]prop3');
            const descendant3 = YAJSPath.parse('$..[prop1 && prop2]prop3');

            expect(descendant1.match(path1)).to.equal(true);
            expect(descendant2.match(path1)).to.equal(false);
            expect(descendant3.match(path1)).to.equal(true);
        });
    });

    // Regression tests for GitHub issue #13: extractKeys()/doExtractKeys() in
    // src/main/lib/path/parser/utils.ts used to build its keys lookup as a
    // plain `{}` object, so `keys['__proto__'] = true` silently hit the
    // inherited Object.prototype `__proto__` accessor's setter instead of
    // creating a real own property - the key was never registered, so
    // drop-keys `<...>`, project `{...}` and filter `[...]` selector syntax
    // could never actually target a "__proto__" key.
    describe('extractKeys with a "__proto__" key (issue #13)', () => {
        it('should extract "__proto__" as a drop key', () => {
            const path = YAJSPath.parse('$<__proto__>');
            expect(path.dropKeys).to.deep.equal([ '__proto__' ]);
        });

        it('should extract "__proto__" as a project key', () => {
            const path = YAJSPath.parse('$.prop1{__proto__}');
            expect(path.projectKeys).to.deep.equal([ '__proto__' ]);
        });

        it('should extract "__proto__" as a filter key and match on it', () => {
            const path1 = YAJSPath.parse('$.__proto__.prop3');

            const descendant1 = YAJSPath.parse('$..[__proto__]prop3');
            const descendant2 = YAJSPath.parse('$..[prop5]prop3');

            expect(descendant1.match(path1)).to.equal(true);
            expect(descendant2.match(path1)).to.equal(false);
        });

        // Regression tests for issue #17: a filter/project/drop-keys key
        // containing a quote used to be interpolated unescaped into a
        // string literal in generated JS (`args['${key}']`), so a key like
        // "key's" broke out of the string and crashed with a raw
        // SyntaxError at parse time instead of being treated as an ordinary
        // key name.
        it('should not throw when a filter key contains an apostrophe', () => {
            expect(() => YAJSPath.parse("$..[key's]prop3")).to.not.throw();
        });

        it('should correctly match on a filter key containing an ' +
            'apostrophe, not just avoid throwing', () => {
            const path1 = YAJSPath.parse("$.key's.prop3");
            const descendant = YAJSPath.parse("$..[key's]prop3");
            expect(descendant.match(path1)).to.equal(true);
        });

        it('should not throw when a project key contains an apostrophe', () => {
            expect(() => YAJSPath.parse("$.prop1{key's}")).to.not.throw();
        });

        it('should not throw when a drop key contains an apostrophe', () => {
            expect(() => YAJSPath.parse("$<key's>")).to.not.throw();
        });
    });

    // Regression tests for issues #18 and #19. #18: YAJSPath.parse() used
    // to rely on ANTLR's default ConsoleErrorListener, which only logs a
    // syntax error to stderr rather than stopping parsing - so a malformed
    // selector either silently fell back to a best-effort (badly wrong)
    // parse tree, or crashed later with an unrelated internal exception,
    // depending on exactly how malformed it was. Fixed with a custom
    // ThrowingErrorListener that fails fast and predictably. #19 is a
    // narrower, separate gap the same fix exposed: the grammar's `path`
    // rule didn't require EOF unless a trailing project/drop-keys clause
    // was present, so ANTLR never even flagged trailing garbage after an
    // otherwise-valid prefix as a syntax error in the first place - no
    // error listener, however correct, can catch what the grammar itself
    // never asks it to detect. Fixed by requiring EOF unconditionally in
    // YAJS.g4 and regenerating (see package.json's exact-pinned, non-caret
    // antlr4ts-cli version - the caret range resolved a canary build whose
    // codegen doesn't compile against this project's pinned antlr4ts
    // runtime typings; 0.4.0-alpha.4 is confirmed compatible).
    describe('invalid selector syntax (issues #18, #19)', () => {

        it('should throw a clean, catchable error for an empty selector, ' +
            'not silently produce a $-equivalent match-everything path', () => {
            expect(() => YAJSPath.parse('')).to.throw(/Invalid selector syntax/);
        });

        it('should throw for a selector not starting with $', () => {
            expect(() => YAJSPath.parse('garbage')).to.throw(/Invalid selector syntax/);
        });

        it('should throw for a dangling trailing dot', () => {
            expect(() => YAJSPath.parse('$.')).to.throw(/Invalid selector syntax/);
        });

        it('should throw for trailing garbage after an otherwise-valid ' +
            'selector (issue #19 - the grammar previously never even ' +
            'looked at what came after a complete-enough prefix)', () => {
            expect(() => YAJSPath.parse('$$')).to.throw(/Invalid selector syntax/);
            expect(() => YAJSPath.parse('$.a.b$$$')).to.throw(/Invalid selector syntax/);
            expect(() => YAJSPath.parse('$.a garbage')).to.throw(/Invalid selector syntax/);
            expect(() => YAJSPath.parse('$xyz')).to.throw(/Invalid selector syntax/);
        });

        it('should still parse a valid selector with a trailing project ' +
            'clause correctly (must not break the one case that already ' +
            'required EOF before issue #19\'s fix)', () => {
            expect(() => YAJSPath.parse('$.a{b}')).to.not.throw();
            expect(() => YAJSPath.parse('$.a<b>')).to.not.throw();
        });
    });

});
