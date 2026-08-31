
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import yajs from '../main/yajs';

// YAJS's entire value proposition is processing input as it arrives in
// arbitrary chunks, yet (before this file) nothing ever exercised that:
// every existing stream-tests fixture was piped through
// fs.createReadStream() and happened to arrive as one implicit OS-sized
// chunk, so chunk-boundary bugs in JsonSaxParser were invisible.
//
// JsonSaxParser is a hand-written byte-by-byte state machine with private
// fields (this.str, this.numStr, this.unicode, the TDQSTR run-length
// counters, etc.) that must persist correctly no matter where a chunk ends
// and the next begins - a truncated unicode escape, a number split
// mid-digit, a string split mid-escape-sequence, or the triple-double-quote
// state machine split at any point should all produce identical results to
// parsing the same document in one shot.
//
// For each fixture below we compute a single-chunk baseline and then
// re-parse the exact same bytes split at every possible two-way byte
// offset, and again with every byte as its own write() call, asserting the
// resulting {path, value} event sequence is byte-for-byte identical to the
// baseline every time.
describe('chunk boundary handling', () => {
    const FIXTURES = ['simple', 'array', 'ndjson', 'triple-dquotes', 'utf8', 'numbers'];

    FIXTURES.forEach((fixture) => {
        it(`should produce identical events for "${fixture}" no matter how ` +
            'the input is split across write() calls', async () => {
            const buf = readFileSync(`${__dirname}/stream-tests/${fixture}.json`);

            const baseline = await run('$', [buf]);
            // Sanity check the baseline itself isn't vacuous - otherwise
            // this test would trivially "pass" while checking nothing.
            expect(baseline.length).to.be.greaterThan(0);

            // Every two-way split point: bytes [0, i) in one write(),
            // [i, len) in the next.
            for (let i = 1; i < buf.length; i++) {
                const actual = await run('$', [buf.subarray(0, i), buf.subarray(i)]);
                expect(actual, `split at byte offset ${i}/${buf.length}`).
                    to.be.deep.equal(baseline);
            }

            // The extreme case: every single byte delivered as its own
            // write() call.
            const oneByteAtATime = Array.from(buf, (b) => Buffer.from([b]));
            const actual = await run('$', oneByteAtATime);
            expect(actual, 'one byte per write() call').to.be.deep.equal(baseline);
        }, 30000);
    });

    // Dedicated, narrowly-scoped regression for GitHub issue #10: a raw
    // (non `\uXXXX`-escaped) multi-byte UTF-8 character split mid-sequence
    // across two separate write() calls must still decode correctly. This
    // is subsumed by the exhaustive 'utf8' fixture above (which tries every
    // split point), but is kept as its own explicit, easy-to-read case: a
    // 4-byte UTF-8 sequence (U+1D11E MUSICAL SYMBOL G CLEF, F0 9D 84 9E)
    // split with its first 2 bytes in one write() and its last 2 in the
    // next - the exact scenario called out in issue #10.
    it('decodes a multi-byte UTF-8 character split mid-sequence across write() calls', async () => {
        const doc = Buffer.from('["𝄞"]', 'utf8');
        // Sanity-check the fixture actually contains a 4-byte UTF-8
        // sequence for the clef character, split roughly in the middle.
        const quoteIndex = doc.indexOf(0x22);
        const clefBytes = doc.subarray(quoteIndex + 1, quoteIndex + 5);
        expect(clefBytes).to.deep.equal(Buffer.from([0xf0, 0x9d, 0x84, 0x9e]));
        const splitAt = quoteIndex + 3; // lands inside the 4-byte sequence

        const result = await run('$', [doc.subarray(0, splitAt), doc.subarray(splitAt)]);
        expect(result).to.have.lengthOf(1);
        expect(result[0].value).to.equal('𝄞');
    });

    // Dedicated, narrowly-scoped regression for GitHub issue #49: a number
    // literal split mid-token across write() calls must still produce
    // exactly the value JSON.parse would produce from the same literal in
    // one piece, at every possible split point - not just "the same value
    // as some (potentially still-wrong) unchunked baseline", which is all
    // the generic 'numbers' fixture above (via the shared `run()` +
    // baseline-comparison harness) actually proves. Covers exact
    // representable edge-of-range values (Number.MAX_VALUE/MIN_VALUE, where
    // the pre-fix digit-by-digit mantissa accumulation silently overflowed
    // to Infinity / underflowed to 0) split at every byte offset, including
    // mid-mantissa, mid-decimal-point, and mid-exponent.
    it('reconstructs the exact value at every possible split point across a number literal (issue #49)', async () => {
        const cases: Array<[string, number]> = [
            ['1.7976931348623157e308', Number.MAX_VALUE],
            ['5e-324', Number.MIN_VALUE],
            ['-1234567890123456789', -1234567890123456789],
            ['-0', -0],
        ];
        for (const [literal, expected] of cases) {
            const doc = Buffer.from(`[${literal}]`);
            for (let i = 1; i < doc.length; i++) {
                const result = await run('$', [doc.subarray(0, i), doc.subarray(i)]);
                expect(result, `${literal} split at byte offset ${i}/${doc.length}`).
                    to.have.lengthOf(1);
                expect(Object.is(result[0].value, expected),
                    `${literal} split at byte offset ${i}/${doc.length}: got ${result[0].value}`).
                    to.be.true;
            }
        }
    }, 30000);
});

// Feeds `chunks` to a fresh yajs() stream as separate write() calls - so the
// underlying JsonSaxParser sees exactly these chunk boundaries, no more and
// no fewer - and resolves with every {path, value} event it emits, in
// order, via the real public stream API (not an internal shortcut).
function run(path: string, chunks: Buffer[]): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
        const result: any[] = [];
        const stream = yajs(path);
        stream.
            on('data', (data: any) => result.push(data)).
            on('end', () => resolve(result)).
            on('error', (err: Error) => reject(err));
        chunks.forEach((chunk) => stream.write(chunk));
        stream.end();
    });
}
