import { describe, expect, it } from 'vitest';
import { ArrayIndex } from '../main/lib/path/operator/ArrayIndex';
import { ChildNode } from '../main/lib/path/operator/ChildNode';
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

    // Regression tests for GitHub issue #27: YAJSPath.match()'s DESCENDANT
    // branch scans backward through the position stack, using the pattern
    // operator preceding '..' (prevScan) to find the ancestor it should
    // resume matching from. That scan used to test prevScan.match(o2)
    // directly against every ancestor position, including ARRAY-typed ones
    // - but ChildNode.match()/Wildcard.match() both unconditionally return
    // true against an ARRAY-typed operand (the single-hop "array is
    // transparent for its parent key" rule used elsewhere in match()),
    // which made the scan stop at the first array it met regardless of
    // whether the sought ancestor was actually there: a false negative when
    // the real match lay further back past the array, and a false positive
    // when an unrelated array let the scan "find" an ancestor that was
    // never a genuine match. Fixed by always skipping ARRAY-typed positions
    // in this scan, unconditionally, and only ever testing prevScan.match()
    // against a real (non-ARRAY) ancestor.
    describe('descendant scan through arrays (issue #27)', () => {

        it('finds a descendant match past a single intervening array preceded by a named key (false negative repro: $.a..b vs {"a":[{"b":2}]})', () => {
            const pattern = YAJSPath.parse('$.a..b');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('b'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('finds a descendant match past a single intervening array preceded by a wildcard, not just a named key ($.*..b vs {"a":[{"b":2}]})', () => {
            const pattern = YAJSPath.parse('$.*..b');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('b'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('finds a descendant match past an array in a longer chain ($.a.b..c vs {"a":{"b":[{"c":5}]}})', () => {
            const pattern = YAJSPath.parse('$.a.b..c');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('b').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('c'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('finds a descendant match past TWO consecutive intervening arrays (adversarial - not just one)', () => {
            const pattern = YAJSPath.parse('$.a..c');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());
            position.push(new ChildNode('c'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('does not spuriously match through an array when the sought ancestor key never occurs anywhere (false positive repro: $..x..y vs {"foo":{"bar":[{"y":"oops"}]}})', () => {
            const pattern = YAJSPath.parse('$..x..y');

            const position = new YAJSPath.Builder().
                addChild('foo').
                addChild('bar').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('y'));

            expect(pattern.match(position)).to.equal(false);
        });

        it('still matches a plain descendant scan with no arrays involved at all (regression guard)', () => {
            const pattern = YAJSPath.parse('$.a..b');
            const position = YAJSPath.parse('$.a.y.b');

            expect(pattern.match(position)).to.equal(true);
        });
    });

    // Regression tests for GitHub issue #28: once YAJSPath.match()'s
    // array-transparency loop let a pattern's Wildcard pass one array
    // boundary, Wildcard.match() being unconditionally true (issue #20)
    // meant it would also silently accept a FURTHER, deeper position level
    // that was really nested one level INSIDE the array's element - i.e. a
    // property of the element, not the element itself - letting '$.*'
    // reach past an array of objects into their own field values as
    // spurious extra matches (and, worse, letting a second concurrent
    // dispatcher hijack events meant for the real element match, corrupting
    // it). Fixed by rejecting a Wildcard's pairing against a non-ARRAY
    // position whose immediate parent position IS an ARRAY, unless the
    // pattern operator that will take responsibility for that array (the
    // one immediately preceding this Wildcard) is itself a WILDCARD or a
    // DESCENDANT - both of which are specifically designed to tolerate
    // exactly that (see YAJSPath.match() for the full reasoning).
    describe('wildcard leak through array elements (issue #28)', () => {

        it('does not let a wildcard reach past an array element into one of its own properties (repro: $.* vs [{"x":1,"y":2}])', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('x'));

            expect(pattern.match(position)).to.equal(false);
        });

        it('still matches the array element itself as a whole (must not regress)', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
        });

        it('does not leak when the array-nested property\'s own value is itself an array, not just an object (repro variant: $.* vs [{"x":[1,2]}])', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('x'));
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(false);
        });

        it('does not leak three levels deep (adversarial: $.* vs [{"x":{"deep":1}}]\'s "deep" position)', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('x'));
            position.push(new ChildNode('deep'));

            expect(pattern.match(position)).to.equal(false);
        });

        it('still lets a chain of wildcards reach one hop at a time through an array ($.*.* must not regress)', () => {
            const pattern = YAJSPath.parse('$.*.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('x'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('still lets a descendant-wildcard reach an array-nested property ($..* must not regress)', () => {
            const pattern = YAJSPath.parse('$..*');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('x'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('still matches a named key inside array elements via $.*.b (issue #20, must not regress)', () => {
            const pattern = YAJSPath.parse('$.*.b');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('b'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('still matches a flat top-level array of scalars via $.* (issue #20, must not regress)', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
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

    // Regression tests for GitHub issue #29: drop-keys (`<...>`) shares the
    // same filterExpression grammar rule as project (`{...}`) and filter
    // (`[...]`), so `&&`/`||`/`!`/parens all parsed without error there too
    // - but Visitor.visitActionDropKeys only ever called extractKeys(),
    // which flattens every leaf key token into a plain list regardless of
    // the boolean structure around them, so e.g. `<key1 && key2>` and
    // `<!key1>` silently behaved exactly like the plain flat list
    // `<key1 key2>` (every named key always dropped unconditionally), with
    // no error or indication the operators had no effect. Rather than give
    // these an ambiguous boolean meaning (dropping is inherently per-key,
    // unlike project/filter's single true/false gate), YAJSPath.parse() now
    // rejects any drop-keys expression that isn't a flat, space-separated
    // list of bare key names - consistent with how issues #18/#19 made
    // other malformed selectors fail cleanly instead of misbehaving
    // silently.
    describe('drop-keys with boolean operators (issue #29)', () => {

        it('still accepts a flat, space-separated key list (must not regress)', () => {
            expect(() => YAJSPath.parse('$<key1 key2>')).to.not.throw();
            expect(YAJSPath.parse('$<key1 key2>').dropKeys).to.deep.equal([ 'key1', 'key2' ]);
        });

        it('still accepts a single bare drop key (must not regress)', () => {
            expect(YAJSPath.parse('$<key1>').dropKeys).to.deep.equal([ 'key1' ]);
        });

        it('throws for an explicit && between drop keys, instead of silently ' +
            'dropping both unconditionally as if it had no effect', () => {
            expect(() => YAJSPath.parse('$<key1 && key2>')).to.throw(/boolean operators/);
        });

        it('throws for an explicit || between drop keys', () => {
            expect(() => YAJSPath.parse('$<key1 || key2>')).to.throw(/boolean operators/);
        });

        it('throws for a NOT-prefixed drop key, instead of silently dropping ' +
            'it exactly as if the `!` were absent', () => {
            expect(() => YAJSPath.parse('$<!key1>')).to.throw(/boolean operators/);
        });

        it('throws for a parenthesized drop-keys group', () => {
            expect(() => YAJSPath.parse('$<(key1)>')).to.throw(/boolean operators/);
        });

        it('throws for a mix of boolean operators among otherwise-flat keys', () => {
            expect(() => YAJSPath.parse('$<key1 key2 && key3>')).to.throw(/boolean operators/);
        });

        it('does not affect project ({...}) syntax, which still accepts boolean operators', () => {
            expect(() => YAJSPath.parse('$.a{key1 && key2}')).to.not.throw();
            expect(() => YAJSPath.parse('$.a{!key1}')).to.not.throw();
        });

        it('does not affect filter ([...]) syntax, which still accepts boolean operators', () => {
            expect(() => YAJSPath.parse('$..[key1 && key2]b')).to.not.throw();
        });
    });

});
