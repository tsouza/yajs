
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
// fields (this.str, this.magnatude, this.unicode, the TDQSTR run-length
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
    const FIXTURES = ['simple', 'array', 'ndjson', 'triple-dquotes'];

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
