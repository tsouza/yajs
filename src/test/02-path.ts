import { describe, expect, it } from 'vitest';
import { StreamPosition } from '../main/lib/context/StreamPosition';
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

    // Regression tests for GitHub issue #45: YAJSPath.match()'s DESCENDANT
    // branch used to commit to the NEAREST ancestor satisfying the pattern
    // operator preceding '..' (prevScan) and just carry on matching the rest
    // of the pattern from there, with no way to reconsider that choice. When
    // the sought key recurs at more than one ancestor depth, the nearest
    // occurrence isn't necessarily the one the REST of the pattern (further
    // out - e.g. a leading Root, which only ever sits directly above a
    // top-level key) can actually match against - so a real, in-document
    // match was silently missed whenever the nearest candidate didn't pan
    // out, instead of backtracking to try the next-farthest one. Fixed by
    // having the DESCENDANT branch try each candidate ancestor, nearest
    // first, recursively verifying the remaining pattern against it and
    // backtracking to the next-farthest one on failure.
    describe('descendant backtracking across repeated ancestor keys (issue #45)', () => {

        it('backtracks past a closer non-qualifying "a" to the outer, qualifying one (own repro: $.a..x vs {"a":{"c":{"a":{"x":1}}}})', () => {
            const pattern = YAJSPath.parse('$.a..x');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('c').
                addChild('a').
                addChild('x').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('still backtracks correctly with more intervening depth between the two "a" occurrences (adversarial)', () => {
            const pattern = YAJSPath.parse('$.a..x');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('c1').
                addChild('c2').
                addChild('c3').
                addChild('a').
                addChild('x').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('still correctly rejects when the qualifying key never occurs at the depth the rest of the pattern needs, even though a closer, non-qualifying occurrence exists (must not become a false positive)', () => {
            const pattern = YAJSPath.parse('$.a..x');

            // "a" here is only ever nested under "c" - never a direct child
            // of root - so no candidate should ever let the pattern's
            // leading Root match what sits above it.
            const position = new YAJSPath.Builder().
                addChild('c').
                addChild('a').
                addChild('x').
                build();

            expect(pattern.match(position)).to.equal(false);
        });

        it('still matches when only the single, nearer "a" is present (regression guard - not everything needs backtracking)', () => {
            const pattern = YAJSPath.parse('$.a..x');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('x').
                build();

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

    // Regression tests for GitHub issue #39: YAJSPath.match()'s DESCENDANT
    // branch resumes matching from the nearest position level satisfying
    // `prevScan` (the pattern operator immediately preceding '..'). That's
    // fine when prevScan is selective (a real key, or Root), but Wildcard/
    // Descendant.match() are both unconditionally true, so the "nearest"
    // candidate is *always* the very next position level - silently
    // capping '..' at exactly one hop whenever it's immediately preceded by
    // a bare wildcard (or another descendant), instead of reaching
    // arbitrary depth like every other '..' composition. Fixed by
    // collapsing through every non-selective (WILDCARD/DESCENDANT) operator
    // first and scanning for the next genuinely selective one instead -
    // which is always found, since pattern[0] is always Root.
    describe('descendant reaches arbitrary depth past a bare wildcard (issue #39)', () => {

        it('does not stop one hop short past "$.*.." (own repro: $.*..* vs {"a":{"x":1,"b":{"c":2}}}\'s "c")', () => {
            const pattern = YAJSPath.parse('$.*..*');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('b').
                addChild('c').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('matches the same position via the equivalent named-key form $.a..* (control, must already pass)', () => {
            const pattern = YAJSPath.parse('$.a..*');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('b').
                addChild('c').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('matches the same position via the equivalent double-descendant form $..*..* (control, must already pass)', () => {
            const pattern = YAJSPath.parse('$..*..*');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('b').
                addChild('c').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('still matches exactly one hop past the wildcard when that\'s all there is (must not regress)', () => {
            const pattern = YAJSPath.parse('$.*..*');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('x').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('collapses a run of wildcards before a descendant the same way (adversarial: $.*.*..* reaching two hops past)', () => {
            const pattern = YAJSPath.parse('$.*.*..*');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('b').
                addChild('c').
                addChild('d').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('still fails to match when the position is genuinely too shallow (must not regress into over-matching)', () => {
            const pattern = YAJSPath.parse('$.*..*');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();

            expect(pattern.match(position)).to.equal(false);
        });

        // Mutation-testing gap: the collapse loop's own condition
        // (WILDCARD-and-unfiltered) OR (DESCENDANT) - i.e. "keep collapsing
        // through a run of bare wildcards/descendants" - has no test that
        // fails if that OR is flipped to AND (which makes the loop body
        // never run at all, since a single prevScan can never be both
        // WILDCARD and DESCENDANT simultaneously). Every existing case above
        // this comment still happens to match correctly even under that
        // flip: issue #45's backtracking search is resilient enough to
        // recover the right answer through plain object-key chains (verified
        // by differential fuzzing the flipped mutant against 50,000 random
        // child/wildcard/descendant selectors over object-only positions -
        // zero divergences). The flip only produces an observable difference
        // once ARRAY levels are involved - confirmed by the same fuzzing
        // once array pushes were mixed in - which makes sense: an
        // uncollapsed wildcard's "how many real hops are still owed" budget
        // (mandatoryHops) silently resets to 0, over-widening the backward
        // scan's search ceiling, and a directly-nested array (no object key
        // between the two array levels) is the simplest shape where that
        // over-widened ceiling accepts a candidate a correctly-narrowed scan
        // would have excluded.
        it('does not silently over-match a directly-nested array via $.*..* when the collapse loop is broken (own repro, found by differential fuzzing against a flipped OR/AND mutant)', () => {
            const pattern = YAJSPath.parse('$.*..*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
        });
    });

    // Regression tests for GitHub issue #38's "dropped match" variant (see
    // 03-yajs.ts for the full corruption-vs-drop root-cause writeup): the
    // "a matched array only consumes ONE pattern operator, so a SECOND
    // consecutive array must not also be skipped transparently" check in
    // YAJSPath.match() rejected unconditionally, even when the pattern
    // operator responsible for that array is a Wildcard immediately
    // preceded (in the pattern) by another Wildcard or a Descendant - which
    // are specifically designed to tolerate exactly that unbounded
    // intervening depth (see the wildcard-into-array-overshoot branch just
    // below it, which already carves out the identical exception for the
    // opposite position shape). Fixed by exempting that same composition
    // here too.
    describe('descendant/wildcard tolerates consecutive arrays (issue #38 dropped-match variant)', () => {

        it('reaches an object nested two array levels deep via $..* (own repro: {"m":[[{"a":1}]]})', () => {
            const pattern = YAJSPath.parse('$..*');

            const position = new YAJSPath.Builder().
                addChild('m').
                build();
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());
            position.push(new ChildNode('a'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('still does NOT let a bare (non-descendant) $.* reach two array levels deep (must not regress issue #28\'s array-of-arrays behavior)', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(false);
        });

        it('reaches three array levels deep via $..* (adversarial, deeper than the own repro)', () => {
            const pattern = YAJSPath.parse('$..*');

            const position = new YAJSPath.Builder().
                addChild('m').
                build();
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());
            position.push(new ChildNode('a'));

            expect(pattern.match(position)).to.equal(true);
        });

        // Mutation-testing gap: tolerateConsecutiveArrays's own o1Type check
        // ("only a WILDCARD may tolerate a consecutive array run, never a
        // plain key/root") has no test that fails if the `&&` joining it to
        // the rest of the condition is loosened enough to apply the
        // tolerance regardless of o1Type. Found by differential fuzzing a
        // `tolerateConsecutiveArrays` mutant that forces its o1Type clause
        // to unconditionally true against ~15,000 random selectors: this is
        // the shrunk minimal repro - a WILDCARD standing for key "a" (whose
        // own consecutive-array tolerance is legitimate) must not leak that
        // tolerance into the FOLLOWING named key "b", which sits two
        // directly-nested array levels below "a.b" with nothing there to
        // select - "b" itself is a plain key, never a wildcard, so it must
        // not reach through more than one array level.
        it('does not let a wildcard\'s consecutive-array tolerance leak into the NAMED key that follows it (own repro: $.*.b vs {"a":{"b":[[...]]}}, found by differential fuzzing)', () => {
            const pattern = YAJSPath.parse('$.*.b');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('b').
                build();
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(false);
        });
    });

    // Regression tests for the wildcard-over-array-valued-key fix: a
    // wildcard meeting an ARRAY position level is genuinely ambiguous (see
    // the two-alternative comment in YAJSPath.matchFrom()'s ARRAY branch) -
    // it can either CONSUME that level as its own hop (a bare top-level
    // array's elements, '$.arr.*') or treat it as transparent scaffolding
    // for the key above it and take that key as its hop instead (exactly
    // ChildNode's own rule). Only the first reading was ever tried, so a
    // '$.*'/'$.b.*' wildcard standing for a key whose value is an array
    // never matched that key's elements at all - the key silently vanished
    // from the output, unlike every sibling form ('$.a', '$.*.*', '$..*').
    describe('wildcard over an array-valued key', () => {

        it('matches an array-valued key\'s element position via $.* (own repro: {"a":[{"x":1}]})', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
        });

        it('matches a nested array-valued key\'s element position via $.b.* (own repro: {"b":{"a":[1,2]}})', () => {
            const pattern = YAJSPath.parse('$.b.*');

            const position = new YAJSPath.Builder().
                addChild('b').
                addChild('a').
                build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
        });

        it('still matches a bare top-level array position via $.* (issue #20, must not regress)', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
        });

        it('still does NOT reach a property inside an array element via $.* (issue #28\'s overshoot guard, must not regress)', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('x'));

            expect(pattern.match(position)).to.equal(false);
        });

        it('still does NOT reach two consecutive array levels deep under a key via $.* (issue #14\'s whole-element capture, must not regress)', () => {
            const pattern = YAJSPath.parse('$.*');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(false);
        });

        it('lets $.*.* reach a property inside an array-valued key\'s element (transparent-array reading, consistent with $..* and $.b.*)', () => {
            const pattern = YAJSPath.parse('$.*.*');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('x'));

            expect(pattern.match(position)).to.equal(true);
        });

        it('still lets $.*.* treat the array level itself as the second hop (elements of an array-valued key, must not regress)', () => {
            const pattern = YAJSPath.parse('$.*.*');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());

            expect(pattern.match(position)).to.equal(true);
        });
    });

    // Regression tests for the filtered-operator fixes: three separate
    // paths through match() silently discarded a '[x]' filter, each turning
    // a filtered operator into its bare (unconditional) form - a false
    // positive in every case. See YAJSPath.matchFrom()'s descendant-collapse
    // and ARRAY-branch comments and StreamPosition.nearestAncestorIndex().
    describe('filters are not dropped by descendant-collapse or array consumption', () => {

        it('does not collapse a FILTERED wildcard before ".." as if it were bare (own repro: $.[x]*..b vs {"y":{"b":1}} - x occurs nowhere)', () => {
            const pattern = YAJSPath.parse('$.[x]*..b');

            const position = new YAJSPath.Builder().
                addChild('y').
                addChild('b').
                build();

            expect(pattern.match(position)).to.equal(false);
        });

        it('still rejects the same shape without ".." (control: $.[x]*.b already rejected)', () => {
            const pattern = YAJSPath.parse('$.[x]*.b');

            const position = new YAJSPath.Builder().
                addChild('y').
                addChild('b').
                build();

            expect(pattern.match(position)).to.equal(false);
        });

        it('still matches through a filtered wildcard before ".." when its filter IS satisfied (must not become a false negative)', () => {
            const pattern = YAJSPath.parse('$.x.[x]*..b');

            const position = new YAJSPath.Builder().
                addChild('x').
                addChild('y').
                addChild('q').
                addChild('b').
                build();

            expect(pattern.match(position)).to.equal(true);
        });

        it('evaluates a filtered wildcard\'s filter even when it consumes an ARRAY level (own repro: $.a.[q]*.b vs {"a":[{"b":1}]} - q occurs nowhere)', () => {
            const pattern = YAJSPath.parse('$.a.[q]*.b');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('b'));

            expect(pattern.match(position)).to.equal(false);
        });

        it('still rejects the same filter against an object-valued key (control: filter enforcement no longer depends on container type)', () => {
            const pattern = YAJSPath.parse('$.a.[q]*.b');

            const position = new YAJSPath.Builder().
                addChild('a').
                addChild('e').
                addChild('b').
                build();

            expect(pattern.match(position)).to.equal(false);
        });

        it('still matches a filtered wildcard consuming an ARRAY level when its filter IS satisfied (must not become a false negative)', () => {
            const pattern = YAJSPath.parse('$.a.[a]*.b');

            const position = new YAJSPath.Builder().
                addChild('a').
                build();
            position.push(new ArrayIndex());
            position.push(new ChildNode('b'));

            expect(pattern.match(position)).to.equal(true);
        });
    });

    // Regression tests driving a real StreamPosition (not a Builder-built
    // base position) through the exact step sequences that used to poison
    // its issue #34 ancestor-key cache - the base linear-scan implementation
    // is the ground truth each expectation was verified against. Two
    // distinct bugs are pinned here:
    //
    // 1. Ancestor-cache corruption: cache entries used to be retired lazily
    //    at slot *reuse* instead of eagerly at pop(), so after a branch
    //    containing key K at depth D closed, a stale [D] entry survived; K
    //    then settling at a shallower depth d made depths[K] = [D, d] (not
    //    increasing), and the next reuse of slot D popped the LIVE d entry
    //    instead of the stale D one - false negatives (a real ancestor no
    //    longer findable) and false positives (a retired depth still
    //    reported) depending on what happened next. Fixed by retiring
    //    eagerly in StreamPosition.pop().
    //
    // 2. Filtered-ancestor cache bypass: the cache indexes ancestors by key
    //    alone, so a '[x]key' ChildNode scan target answered from it never
    //    had its filter evaluated at all. Fixed by falling back to the base
    //    linear scan for filtered targets.
    describe('streaming ancestor-key cache (issue #34) stays correct', () => {

        // Walks position through the events of {"a":{"b":{"k":{"z":1}}}} -
        // opening and fully closing a branch that settles "k" at stack
        // index 3 - and then into a sibling "k" branch that settles "k" at
        // the shallower index 1, the exact sequence that used to corrupt
        // the cache.
        function poisonThenReopen(position: StreamPosition): void {
            position.stepIntoObject();          // index 1
            position.updateObjectEntry('a');
            position.stepIntoObject();          // index 2
            position.updateObjectEntry('b');
            position.stepIntoObject();          // index 3
            position.updateObjectEntry('k');
            position.stepIntoObject();          // index 4
            position.updateObjectEntry('z');
            position.stepOutObject();
            position.stepOutObject();
            position.stepOutObject();
            position.updateObjectEntry('k');    // "k" again, now at index 1
        }

        it('still finds a "k" ancestor settled at a shallower depth after a deeper "k" branch closed (false negative repro: $..k..m vs {"a":{"b":{"k":{"z":1}}},"k":{"x":{"m":2}}})', () => {
            const pattern = YAJSPath.parse('$..k..m');

            const position = new StreamPosition();
            poisonThenReopen(position);
            position.stepIntoObject();          // index 2
            position.updateObjectEntry('x');
            position.stepIntoObject();          // index 3 - reuses the slot
                                                // whose stale "k" entry used
                                                // to mis-retire the live one
            position.updateObjectEntry('m');

            expect(pattern.match(position)).to.equal(true);
        });

        it('does not report the closed deeper "k" as still open (false positive repro: $.k.x..k..m vs {"a":{"b":{"k":{"z":1}}},"k":{"x":{"q":{"m":2}}}} - no second "k" above "m")', () => {
            const pattern = YAJSPath.parse('$.k.x..k..m');

            const position = new StreamPosition();
            poisonThenReopen(position);
            position.stepIntoObject();          // index 2
            position.updateObjectEntry('x');
            position.stepIntoObject();          // index 3
            position.updateObjectEntry('q');
            position.stepIntoObject();          // index 4
            position.updateObjectEntry('m');

            expect(pattern.match(position)).to.equal(false);
        });

        it('evaluates a filtered ChildNode scan target\'s filter instead of answering from the key-only cache (own repro: $..[x]a..b vs {"y":{"a":{"b":1}}} - x occurs nowhere)', () => {
            const pattern = YAJSPath.parse('$..[x]a..b');

            const position = new StreamPosition();
            position.stepIntoObject();
            position.updateObjectEntry('y');
            position.stepIntoObject();
            position.updateObjectEntry('a');
            position.stepIntoObject();
            position.updateObjectEntry('b');

            expect(pattern.match(position)).to.equal(false);
        });

        it('still matches a filtered ChildNode scan target when its filter IS satisfied (control: $..[x]a..b vs {"x":{"a":{"b":1}}})', () => {
            const pattern = YAJSPath.parse('$..[x]a..b');

            const position = new StreamPosition();
            position.stepIntoObject();
            position.updateObjectEntry('x');
            position.stepIntoObject();
            position.updateObjectEntry('a');
            position.stepIntoObject();
            position.updateObjectEntry('b');

            expect(pattern.match(position)).to.equal(true);
        });
    });

    // Regression tests driving a real StreamPosition directly through
    // stepIntoObject()/updateObjectEntry()/stepOutObject()/stepIntoArray()/
    // increaseArrayIndex()/stepOutArray(), the same style as the ancestor-key
    // cache block above, but for the sibling path-segment cache (issue #44:
    // mSegments/mSegmentBaseline backing path()). Unlike the ancestor-key
    // cache, this bookkeeping has no dedicated direct coverage anywhere else
    // - every other test only observes it indirectly, through whatever path
    // a match happens to report - so a corrupted truncation (e.g.
    // truncateSegmentsAt() becoming a no-op, or being called with the wrong
    // index) could easily go unnoticed if it still happened to leave the
    // RIGHT segments on top, by coincidence, for every scenario those tests
    // exercise. Each expectation below was confirmed to actually fail when
    // truncateSegmentsAt() was temporarily stubbed out.
    describe('streaming path-segment cache (issue #44) stays correct', () => {

        it('truncates mSegments back to baseline when a sibling key replaces the old one at the same reused slot', () => {
            const position = new StreamPosition(false /* pathIncludeArrayIndex */);
            position.stepIntoObject();
            position.updateObjectEntry('a');
            position.stepIntoObject();
            position.updateObjectEntry('old');
            position.stepOutObject();               // slot at index 1 closes
            position.stepIntoObject();               // reuses that same slot
            position.updateObjectEntry('new');

            expect(position.path(false)).to.deep.equal(['a', 'new']);
        });

        it('replaces a still-open object\'s own segment when a second key arrives without any intervening stepOut (e.g. {"a":1,"b":2})', () => {
            const position = new StreamPosition(false);
            position.stepIntoObject();
            position.updateObjectEntry('a');

            expect(position.path(false)).to.deep.equal(['a']);

            position.updateObjectEntry('b');         // same object, next key

            expect(position.path(false)).to.deep.equal(['b']);
        });

        it('drops a closed branch\'s deeper segments on stepOutObject, leaving only the still-open shallower ones', () => {
            const position = new StreamPosition(false);
            position.stepIntoObject();
            position.updateObjectEntry('a');
            position.stepIntoObject();
            position.updateObjectEntry('b');
            position.stepIntoObject();
            position.updateObjectEntry('c');

            expect(position.path(false)).to.deep.equal(['a', 'b', 'c']);

            position.stepOutObject();                // "c" branch closes

            expect(position.path(false)).to.deep.equal(['a', 'b']);

            position.stepOutObject();                // "b" branch closes

            expect(position.path(false)).to.deep.equal(['a']);
        });

        it('keeps an object\'s own segment intact when a deeper sibling branch that reused a lower slot closes (no cross-slot leakage)', () => {
            // {"a":{"x":{"p":1},"y":{"q":2}}} - "x" and "y" both open/close a
            // one-level-deeper slot under "a"; "a" itself must still read
            // back correctly after each of them is done with that slot.
            const position = new StreamPosition(false);
            position.stepIntoObject();
            position.updateObjectEntry('a');
            position.stepIntoObject();
            position.updateObjectEntry('x');
            position.stepIntoObject();
            position.updateObjectEntry('p');
            position.stepOutObject();
            position.stepOutObject();                // back to "a"'s object

            expect(position.path(false)).to.deep.equal(['a']);

            position.stepIntoObject();               // reuses "x"'s old slot
            position.updateObjectEntry('y');
            position.stepIntoObject();
            position.updateObjectEntry('q');

            expect(position.path(false)).to.deep.equal(['a', 'y', 'q']);

            position.stepOutObject();
            position.stepOutObject();

            expect(position.path(false)).to.deep.equal(['a']);
        });

        it('replaces the array\'s own contributed index segment on each sibling element, and truncates it away on stepOutArray, when pathIncludeArrayIndex is on', () => {
            const position = new StreamPosition(true /* pathIncludeArrayIndex */);
            position.stepIntoObject();
            position.updateObjectEntry('a');
            position.stepIntoArray();
            position.increaseArrayIndex();           // element 0

            expect(position.path()).to.deep.equal(['a', 0]);

            position.increaseArrayIndex();           // element 1 (sibling)

            expect(position.path()).to.deep.equal(['a', 1]);

            position.stepOutArray();

            expect(position.path()).to.deep.equal(['a']);
        });

        it('does not contribute an index segment for a reused array slot when pathIncludeArrayIndex is off', () => {
            const position = new StreamPosition(false);
            position.stepIntoObject();
            position.updateObjectEntry('a');
            position.stepIntoArray();
            position.increaseArrayIndex();
            position.increaseArrayIndex();

            expect(position.path(false)).to.deep.equal(['a']);

            position.stepOutArray();

            expect(position.path(false)).to.deep.equal(['a']);
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

    // Regression tests for GitHub issue #37: AbstractFilteredOperator.
    // matchFilter() used to discard the `matches` boolean it was given (the
    // actual key-name/wildcard-equality check computed by
    // ChildNode.matches()/Wildcard.match()) whenever a filter expression was
    // attached, replacing the whole verdict with only the ancestor-filter
    // predicate's own outcome. So '$..[key1]child' matched EVERY sibling key
    // inside a 'key1'-satisfying ancestor, not just keys literally named
    // "child" - because once the filter was present, the "is this key
    // actually named child" check never factored in at all.
    describe('filter does not drop the key-name check (issue #37)', () => {
        it('does not match a differently-named sibling key inside a filtered ancestor ' +
            '($..[key1]child vs $.key1.other)', () => {
            const siblingPath = YAJSPath.parse('$.key1.other');
            const descendant = YAJSPath.parse('$..[key1]child');

            expect(descendant.match(siblingPath)).to.equal(false);
        });

        it('still matches the correctly-named key inside the filtered ancestor ' +
            '($..[key1]child vs $.key1.child)', () => {
            const childPath = YAJSPath.parse('$.key1.child');
            const descendant = YAJSPath.parse('$..[key1]child');

            expect(descendant.match(childPath)).to.equal(true);
        });

        it('still rejects when the filter predicate itself is false, independent of the ' +
            'key-name check ($..[key5]child vs $.key1.child)', () => {
            const childPath = YAJSPath.parse('$.key1.child');
            const descendant = YAJSPath.parse('$..[key5]child');

            expect(descendant.match(childPath)).to.equal(false);
        });
    });

    // Mutation-testing gap: `mDefinite`'s initial value (true) is only ever
    // read as-is for a pattern with NO descendant at all - the constructor's
    // own loop unconditionally sets it to false the moment it sees one, but
    // never sets it back to true, so a pattern without '..' relies entirely
    // on the field's initializer. No existing test asserted on `.definite`/
    // `.minimumDepth` directly, so flipping that initializer to false
    // survived even though `.definite` is a real, consumed public property
    // (StreamContext/FastPathEvaluator gate the ancestor-key cache and the
    // fast path's depth-based early exit on it - see StreamPosition's field
    // comment).
    describe('definite/minimumDepth', () => {
        it('is definite, with minimumDepth equal to its own depth, for a path with no descendant', () => {
            const pattern = YAJSPath.parse('$.a.b');

            expect(pattern.definite).to.equal(true);
            expect(pattern.minimumDepth).to.equal(3); // Root, a, b
        });

        it('is NOT definite, with minimumDepth counting only the real (non-descendant) operators, once a path contains a descendant', () => {
            const pattern = YAJSPath.parse('$.a..b');

            expect(pattern.definite).to.equal(false);
            expect(pattern.minimumDepth).to.equal(3); // Root, a, b - the descendant itself contributes no fixed depth
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

    // Regression tests for GitHub issue #52: pathLeaf's own grammar rule
    // (`pathLeaf: actionProject | actionDropKeys`) already makes project
    // (`{...}`) and drop-keys (`<...>`) mutually exclusive - a selector may
    // end in at most one of them - but writing both anyway (e.g.
    // `$.a{x}<y>`) used to surface as a raw, internal ANTLR message
    // ("mismatched input '<' expecting <EOF>") rather than a clear one, since
    // pathLeaf just matches whichever comes first and the second is left as
    // unconsumed trailing input that only fails once EOF is expected.
    // YAJSPath.parse() now rejects this combination up front with a
    // purpose-built message, the same pattern issue #29 established above
    // for drop-keys' own boolean-operator restriction.
    describe('project and drop-keys combined (issue #52)', () => {

        it('throws a clear error for project followed by drop-keys', () => {
            expect(() => YAJSPath.parse('$.a{x}<y>')).to.throw(/mutually exclusive/);
        });

        it('throws a clear error for drop-keys followed by project', () => {
            expect(() => YAJSPath.parse('$.a<y>{x}')).to.throw(/mutually exclusive/);
        });

        it('still accepts project alone (must not regress)', () => {
            expect(() => YAJSPath.parse('$.a{x}')).to.not.throw();
        });

        it('still accepts drop-keys alone (must not regress)', () => {
            expect(() => YAJSPath.parse('$.a<y>')).to.not.throw();
        });
    });

});
