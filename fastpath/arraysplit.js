// Streaming top-level-array element splitter: a structural byte scanner
// (quote/escape state + bracket depth) that finds depth-1 element spans of
// a top-level JSON array and hands each element's text to a callback.
// Chunk-boundary safe: bytes of an unfinished element are buffered until
// its balancing close arrives.
'use strict';

const OPEN_BRACE = 0x7b, CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b, CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22, BACKSLASH = 0x5c, COMMA = 0x2c;

function isWs(b) { return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d; }

class ArrayElementSplitter {
    // onElement(text): one top-level element's JSON text (trimmed span)
    constructor(onElement) {
        this.onElement = onElement;
        this.depth = 0;         // container depth; the root array is depth 1
        this.inStr = false;
        this.esc = false;
        this.seenRoot = false;  // saw the opening [
        this.done = false;      // saw the closing ]
        this.pending = null;    // Buffer of the current element's bytes so far
        this.elemStart = -1;    // start offset of current element in current chunk (-1: none)
        this.maxPending = 0;    // stat: largest cross-chunk buffered element
    }

    write(chunk) {
        let i = 0;
        const len = chunk.length;
        if (!this.seenRoot) {
            while (i < len && isWs(chunk[i])) { i++; }
            if (i === len) { return; }
            if (chunk[i] !== OPEN_BRACKET) {
                throw new Error('not a top-level array');
            }
            this.seenRoot = true;
            this.depth = 1;
            i++;
        }
        let elemStart = this.elemStart >= 0 ? 0 : -1; // pending continues at chunk start
        // If an element is mid-flight from previous chunks, its bytes so far
        // are in this.pending and it continues at offset 0 of this chunk.
        for (; i < len; i++) {
            const b = chunk[i];
            if (this.inStr) {
                if (this.esc) { this.esc = false; }
                else if (b === BACKSLASH) { this.esc = true; }
                else if (b === QUOTE) { this.inStr = false; }
                continue;
            }
            switch (b) {
                case QUOTE:
                    this.inStr = true;
                    if (this.depth === 1 && elemStart < 0) { elemStart = i; }
                    break;
                case OPEN_BRACE:
                case OPEN_BRACKET:
                    if (this.depth === 1 && elemStart < 0) { elemStart = i; }
                    this.depth++;
                    break;
                case CLOSE_BRACE:
                    this.depth--;
                    break;
                case CLOSE_BRACKET:
                    this.depth--;
                    if (this.depth === 0) {
                        // end of the root array: flush last element (if any)
                        if (elemStart >= 0) { this.finishElement(chunk, elemStart, i); }
                        elemStart = -1;
                        this.done = true;
                    }
                    break;
                case COMMA:
                    if (this.depth === 1) {
                        if (elemStart >= 0) { this.finishElement(chunk, elemStart, i); }
                        elemStart = -1;
                    }
                    break;
                default:
                    if (this.depth === 1 && elemStart < 0 && !isWs(b)) {
                        elemStart = i; // scalar element starts
                    }
            }
        }
        // chunk exhausted with an element still open: buffer its bytes
        if (elemStart >= 0) {
            const part = chunk.subarray(elemStart, len);
            this.pending = this.pending ? Buffer.concat([this.pending, part]) : Buffer.from(part);
            if (this.pending.length > this.maxPending) { this.maxPending = this.pending.length; }
            this.elemStart = 0;
        } else {
            this.elemStart = -1;
        }
    }

    finishElement(chunk, start, end) {
        let text;
        if (this.pending) {
            // concat as BYTES before decoding: the pending/chunk seam can
            // fall inside a multi-byte UTF-8 sequence
            text = Buffer.concat([this.pending, chunk.subarray(start, end)]).toString('utf8');
            this.pending = null;
        } else {
            text = chunk.toString('utf8', start, end);
        }
        this.elemStart = -1;
        // trim trailing ws (leading is excluded by elemStart placement)
        text = text.trimEnd();
        if (text.length > 0) { this.onElement(text); }
    }

    end() {
        if (!this.done && this.seenRoot) {
            throw new Error('unterminated top-level array');
        }
    }
}

module.exports = { ArrayElementSplitter };
