
import { describe, expect, it } from 'vitest';

import { StreamContext } from '../main/lib/context/StreamContext';
import { YAJSPath } from '../main/lib/path/YAJSPath';

// Unit-level regression tests for StreamContext itself, complementing the
// end-to-end (piped through the real yajs() stream) tests in
// 04-error-handling.ts.
//
// These matter in addition to the end-to-end ones because, as of GitHub
// issue #11, JsonSaxParser now independently validates bracket-matching
// grammar at the tokenizer level and refuses to call
// context.endArray()/endObject() at all for an unmatched close from real
// input - which means an end-to-end "pipe `]` through yajs()" test no
// longer specifically exercises StreamContext's own guard (JsonSaxParser's
// tokenizer-level check gets there first). StreamContext.endArray()/
// endObject()/startObjectEntry() are still public methods that can be
// called directly - by a future caller that bypasses JsonSaxParser, or
// simply by a bug in JsonSaxParser's own grammar validation letting
// something through - so they need to keep defending themselves in their
// own right, and that is what these tests pin down directly.
function newContext(path = '$'): { context: StreamContext; matches: any[]; errors: Error[] } {
    const matches: any[] = [];
    const errors: Error[] = [];
    const context = new StreamContext(
        YAJSPath.parse(path),
        (p, value) => matches.push({ path: p, value }),
        false,
        (err) => errors.push(err));
    return { context, matches, errors };
}

// Regression tests for https://github.com/tsouza/yajs/issues/9 ("silent
// hang / zero signal on an unmatched closing bracket"). Root cause:
// StreamContext.endArray()/endObject() called
// this.position.stepOutArray()/stepOutObject() unconditionally, which threw
// a synchronous TypeError (this.position was undefined, or - once the
// document had genuinely finished - already back at its own base) instead
// of reporting anything through StreamContext's normal channels.
describe('StreamContext structural error reporting (issue #9)', () => {

    it('reports an unmatched endArray() as a single error, not a throw', () => {
        const { context, errors } = newContext();
        expect(() => context.endArray()).not.to.throw();
        expect(errors).to.have.lengthOf(1);
        expect(errors[0].message).to.match(/Unexpected end of array/);
    });

    it('reports an unmatched endObject() as a single error, not a throw', () => {
        const { context, errors } = newContext();
        expect(() => context.endObject()).not.to.throw();
        expect(errors).to.have.lengthOf(1);
        expect(errors[0].message).to.match(/Unexpected end of object/);
    });

    it('reports startObjectEntry() with no object open as a single error, not a throw', () => {
        const { context, errors } = newContext();
        expect(() => context.startObjectEntry('key')).not.to.throw();
        expect(errors).to.have.lengthOf(1);
    });

    it('reports an endArray() with nothing left open, after a legitimately-closed array, as an error', () => {
        const { context, errors } = newContext();
        context.startArray();
        context.onValue(1);
        context.endArray();
        expect(errors).to.have.lengthOf(0);
        context.endArray(); // extra, unmatched close
        expect(errors).to.have.lengthOf(1);
    });

    it('does not report an error, and does not throw, for legitimately balanced deep nesting', () => {
        const { context, errors } = newContext();
        const depth = 3000;
        for (let i = 0; i < depth; i++) { context.startArray(); }
        for (let i = 0; i < depth; i++) { context.endArray(); }
        expect(errors).to.have.lengthOf(0);
    });

    it('reports the structural error exactly once and ignores further tokens afterwards', () => {
        const { context, matches, errors } = newContext();
        context.endArray(); // unmatched - reports the one error
        context.endArray(); // would also be unmatched, but must be a no-op now
        context.startArray();
        context.onValue(1);
        context.endArray();
        expect(errors).to.have.lengthOf(1);
        // Nothing after the error should have been interpreted as a match.
        expect(matches).to.have.lengthOf(0);
    });

    it('by default (no onError callback supplied) preserves the old throwing behavior', () => {
        const context = new StreamContext(YAJSPath.parse('$'), () => { /* noop */ }, false);
        expect(() => context.endArray()).to.throw();
    });
});

// Regression test for https://github.com/tsouza/yajs/issues/8 ("OOM crash
// on deeply nested arrays at the root"), exercised directly at the
// StreamContext level (no tokenizer/stream overhead) so the timing signal
// is as close as possible to the exact mechanism that was fixed: dispatch()
// used to forward every event to *every* dispatcher ever created for a run
// of consecutive array opens (O(n) work per event, O(n) events -> O(n^2)),
// instead of only to the single currently-active one.
describe('StreamContext dispatcher bookkeeping stays linear (issue #8)', () => {

    it('processes a run of consecutive array opens in time roughly ' +
        'proportional to depth, not to depth squared', () => {
        function timeOpens(depth: number): number {
            const { context } = newContext();
            const start = Date.now();
            for (let i = 0; i < depth; i++) { context.startArray(); }
            return Date.now() - start;
        }

        // Warm up the JIT before measuring, so the comparison isn't
        // dominated by one-time compilation cost.
        timeOpens(500);

        const small = timeOpens(2000);
        const large = timeOpens(20000); // 10x the depth

        // A genuinely O(n) implementation should take on the order of 10x
        // as long for 10x the depth (with a very generous margin for noise);
        // the pre-fix O(n^2) implementation took on the order of 100x as
        // long (in fact worse in practice - see 04-error-handling.ts's
        // wall-clock regression test - since it also does 10x the
        // *allocation* per level). 40x is comfortably below "quadratic" and
        // comfortably above ordinary timing noise.
        expect(large, `small=${small}ms large=${large}ms`).to.be.lessThan(Math.max(small, 1) * 40);
    }, 20000);
});
