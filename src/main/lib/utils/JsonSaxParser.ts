/*
The MIT License (MIT) Copyright (c) 2011-2012 Tim Caswell

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// Named constants with unique integer values
const C: any = {};
// Tokenizer States
const START   = C.START   = 0x11;
const TRUE1   = C.TRUE1   = 0x21;
const TRUE2   = C.TRUE2   = 0x22;
const TRUE3   = C.TRUE3   = 0x23;
const FALSE1  = C.FALSE1  = 0x31;
const FALSE2  = C.FALSE2  = 0x32;
const FALSE3  = C.FALSE3  = 0x33;
const FALSE4  = C.FALSE4  = 0x34;
const NULL1   = C.NULL1   = 0x41;
const NULL2   = C.NULL3   = 0x42;
const NULL3   = C.NULL2   = 0x43;
const NUMBER1 = C.NUMBER1 = 0x51;
const NUMBER2 = C.NUMBER2 = 0x52;
const NUMBER3 = C.NUMBER3 = 0x53;
const NUMBER4 = C.NUMBER4 = 0x54;
const NUMBER5 = C.NUMBER5 = 0x55;
const NUMBER6 = C.NUMBER6 = 0x56;
const NUMBER7 = C.NUMBER7 = 0x57;
const NUMBER8 = C.NUMBER8 = 0x58;
const STRING1 = C.STRING1 = 0x61;
const STRING2 = C.STRING2 = 0x62;
const STRING3 = C.STRING3 = 0x63;
const STRING4 = C.STRING4 = 0x64;
const STRING5 = C.STRING5 = 0x65;
const STRING6 = C.STRING6 = 0x66;
const TDQSTR1 = C.TDQSTR1 = 0x71;
const TDQSTR2 = C.TDQSTR2 = 0x72;
const TDQSTR3 = C.TDQSTR3 = 0x73;
const TDQSTR4 = C.TDQSTR4 = 0x74;
const TDQSTR5 = C.TDQSTR5 = 0x75;
const TDQSTR6 = C.TDQSTR6 = 0x76;
// Terminal state entered after an unrecoverable parse error. Once here, the
// parser stops interpreting further bytes (no more callbacks fire) instead
// of falling through into whatever case happens to follow textually.
const ERROR   = C.ERROR   = 0x91;

// --------------------------------------------------------------------
// Structural (between-token) grammar validation.
//
// Everything above only validates WITHIN a token (a number's digits, a
// string's escapes, a literal's letters, ...). Nothing previously checked
// the grammar BETWEEN tokens - that array/object elements are actually
// comma-separated, that an object key is followed by `:`, that a `]`/`}`
// matches a real open bracket, or that a document doesn't end while a
// structure is still open. `awaiting` + `structStack` below track exactly
// the kind of state a recursive-descent grammar would carry on its call
// stack, flattened into an explicit stack because the byte-by-byte
// tokenizer can't use the real JS call stack - a container can stay open
// across arbitrarily many parse() calls/chunks.
//
// AWAIT_* names what's legal next. Frames on `structStack` are just the
// container kind (ARRAY/OBJECT) - enough to know what a `]`/`}` needs to
// match, and what "an element/entry was just supplied" collapses back to
// once the container that held it closes.
const AWAIT_DOC_VALUE          = 0xa1; // top level: ready for a value (first one, or - NDJSON - the next one)
const AWAIT_DOC_AFTER_VALUE    = 0xa2; // top level: value just completed - only whitespace/EOF legal until a separator is seen
const AWAIT_ARRAY_VALUE_OPEN   = 0xa3; // just saw `[`: a value or `]` (empty array) is legal
const AWAIT_ARRAY_VALUE_COMMA  = 0xa4; // just saw `,` in an array: a value is legal, `]` is not (no trailing comma)
const AWAIT_ARRAY_COMMA_CLOSE  = 0xa5; // after an array element: `,` or `]` is legal
const AWAIT_OBJECT_KEY_OPEN    = 0xa6; // just saw `{`: a string key or `}` (empty object) is legal
const AWAIT_OBJECT_KEY_COMMA   = 0xa7; // just saw `,` in an object: a string key is legal, `}` is not (no trailing comma)
const AWAIT_OBJECT_COLON       = 0xa8; // just saw a key string: only `:` is legal
const AWAIT_OBJECT_VALUE       = 0xa9; // just saw `:`: a value is legal
const AWAIT_OBJECT_COMMA_CLOSE = 0xaa; // after an object entry's value: `,` or `}` is legal

const FRAME_ARRAY  = 0xb1;
const FRAME_OBJECT = 0xb2;

// Slow code to string converter (only used when throwing syntax errors)
function toknam(code) {
  const keys = Object.keys(C);
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i];
    if (C[key] === code) { return key; }
  }
  return code && ('0x' + code.toString(16));
}

export class JsonSaxParser {

  private callbacks: JsonSaxParser.ICallbacks;

  private mState: number;
  private str: string;
  private unicode: string;
  private negative: boolean;
  private magnatude: number;
  private position: number;
  private exponent: number;
  private negativeExponent: boolean;
  // Whether the string currently being parsed opened as a triple-double-quote
  // (`"""`) string. Must persist as instance state (not a local in parse())
  // because a chunk boundary can land anywhere inside a TDQSTR body - a
  // local variable would silently reset to false on the next write() call,
  // corrupting parsing of any triple-quoted string that spans a chunk split.
  private tdq: boolean = false;

  // UTF-8 decoder state for the raw (non `\uXXXX`-escaped) byte path in
  // STRING1. Each input buffer is a *byte* stream, but a JSON string's raw
  // (non-ASCII) content is UTF-8 - a single character can be 1-4 bytes - so
  // decoding requires accumulating continuation bytes across calls to
  // appendUtf8Byte(). Exactly like `tdq` above, this must be instance state
  // rather than locals in parse()/appendUtf8Byte(): a multi-byte UTF-8
  // sequence can legitimately be split across two separate write() calls
  // (e.g. a 4-byte emoji with its first 2 bytes in one chunk and its last 2
  // in the next), and a local variable would silently forget the
  // in-progress sequence when that chunk boundary hit.
  //
  // Follows the WHATWG UTF-8 decoder algorithm
  // (https://encoding.spec.whatwg.org/#utf-8-decoder): utf8BytesNeeded is
  // the number of continuation bytes still expected (0 = not mid-sequence),
  // utf8BytesSeen is how many of those have arrived so far, utf8CodePoint
  // accumulates the code point bits decoded so far, and
  // utf8Lower/UpperBoundary narrow the valid range for the *first*
  // continuation byte after certain lead bytes (0xE0, 0xED, 0xF0, 0xF4) to
  // reject overlong encodings and encoded surrogates.
  private utf8CodePoint = 0;
  private utf8BytesSeen = 0;
  private utf8BytesNeeded = 0;
  private utf8LowerBoundary = 0x80;
  private utf8UpperBoundary = 0xbf;

  // Structural grammar state - see the AWAIT_*/FRAME_* constants above.
  // Both must be plain instance state, for the same chunk-boundary reason
  // as `tdq` and the UTF-8 decoder fields: a container can legitimately
  // stay open across many separate parse() calls.
  private awaiting: number = AWAIT_DOC_VALUE;
  private structStack: number[] = [];
  // Whether any top-level value has ever been completed. Distinguishes, at
  // end-of-stream, "nothing ever arrived" (an empty or whitespace-only
  // document - genuinely invalid: RFC 8259 requires exactly one value) from
  // "stream ended right after legitimately completing the/a value"
  // (valid - including after the last value of an NDJSON stream).
  private sawValue: boolean = false;

  // Whether an error has ever been reported anywhere in this stream's
  // lifetime (set once in charError()/structuralError(), alongside `state =
  // ERROR`, and - unlike `state` itself - never cleared by resyncAfterError()
  // below). Once true, finish()'s own "empty document" check is suppressed
  // (see the comment there): that check exists to flag a stream that never
  // produced any value at all, which is a meaningful signal only for a
  // stream that was otherwise clean. After a resync, a stream that never
  // gets another valid top-level value before EOF isn't "empty" in that
  // sense - it already got exactly one real error, and finish() must not
  // pile a second, misleading one on top (mirrors the ERROR-state guard at
  // the top of finish(), extended to cover the case where `state` itself
  // has since moved back to START via a resync).
  private hadError: boolean = false;

  constructor(callback: JsonSaxParser.ICallbacks) {
    this.callbacks = callback;
    this.state = START;
  }

  private get state(): number {
    return this.mState;
  }

  private set state(state: number) {
    this.mState = state;
  }

  // True when a value (string/number/bool/null/`{`/`[`) is grammatically
  // legal right now - i.e. NOT when an object key, `:`, `,`, or a close
  // bracket is what's actually expected next.
  private expectingValue(): boolean {
    switch (this.awaiting) {
    case AWAIT_DOC_VALUE:
    case AWAIT_ARRAY_VALUE_OPEN:
    case AWAIT_ARRAY_VALUE_COMMA:
    case AWAIT_OBJECT_VALUE:
      return true;
    default:
      return false;
    }
  }

  // True when a string used as an object *key* (as opposed to a value) is
  // what's expected next.
  private expectingKey(): boolean {
    return this.awaiting === AWAIT_OBJECT_KEY_OPEN || this.awaiting === AWAIT_OBJECT_KEY_COMMA;
  }

  // Checks that a value is legal here and, if not, reports the structural
  // error itself (so callers can just `if (!this.requireValuePosition(...)) { continue; }`).
  private requireValuePosition(buffer: Buffer, i: number): boolean {
    if (this.expectingValue()) { return true; }
    this.structuralError(buffer, i, this.expectingKey() ? 'a string key' : 'a value');
    return false;
  }

  // Called the instant a scalar (string-as-value/number/true/false/null)
  // value's first byte is confirmed legal. However many bytes/chunks the
  // token itself takes to actually finish tokenizing, nothing else
  // consults `awaiting` until control returns to the START state - so it's
  // safe, and simplest, to move straight to "a value was just supplied"
  // right away instead of waiting for the token to complete.
  private enterValue(): void {
    const top = this.structStack[this.structStack.length - 1];
    if (top === FRAME_ARRAY) {
      this.awaiting = AWAIT_ARRAY_COMMA_CLOSE;
    } else if (top === FRAME_OBJECT) {
      this.awaiting = AWAIT_OBJECT_COMMA_CLOSE;
    } else {
      this.awaiting = AWAIT_DOC_AFTER_VALUE;
      this.sawValue = true;
    }
  }

  // Called the instant a string's opening quote is confirmed to be an
  // object *key* rather than a value.
  private enterKey(): void {
    this.awaiting = AWAIT_OBJECT_COLON;
  }

  private pushContainer(frame: number): void {
    this.structStack.push(frame);
    this.awaiting = frame === FRAME_ARRAY ? AWAIT_ARRAY_VALUE_OPEN : AWAIT_OBJECT_KEY_OPEN;
  }

  // Pops the container just closed by a `]`/`}` and figures out what's
  // legal next, which depends on *its* container (or the document level, if
  // this was the outermost one) - closing a container is itself "supplying
  // a value" to whatever contains it.
  private popContainer(): void {
    this.structStack.pop();
    const top = this.structStack[this.structStack.length - 1];
    if (top === FRAME_ARRAY) {
      this.awaiting = AWAIT_ARRAY_COMMA_CLOSE;
    } else if (top === FRAME_OBJECT) {
      this.awaiting = AWAIT_OBJECT_COMMA_CLOSE;
    } else {
      this.awaiting = AWAIT_DOC_AFTER_VALUE;
      this.sawValue = true;
    }
  }

  private canCloseArray(): boolean {
    return this.awaiting === AWAIT_ARRAY_VALUE_OPEN || this.awaiting === AWAIT_ARRAY_COMMA_CLOSE;
  }

  private canCloseObject(): boolean {
    return this.awaiting === AWAIT_OBJECT_KEY_OPEN || this.awaiting === AWAIT_OBJECT_COMMA_CLOSE;
  }

  // Validates a `,` and, if legal, advances `awaiting` to "expecting the
  // next element/entry" (which - unlike right after `[`/`{` - does NOT
  // also accept an immediate close: no trailing commas).
  private tryComma(): boolean {
    if (this.awaiting === AWAIT_ARRAY_COMMA_CLOSE) {
      this.awaiting = AWAIT_ARRAY_VALUE_COMMA;
      return true;
    }
    if (this.awaiting === AWAIT_OBJECT_COMMA_CLOSE) {
      this.awaiting = AWAIT_OBJECT_KEY_COMMA;
      return true;
    }
    return false;
  }

  parse(buffer: Buffer) {
    let n;
    for (let i = 0, l = buffer.length; i < l; i++) {
      switch (this.state) {
      case ERROR:
        // The failed document's own error was already reported; nothing
        // read from here on is trusted as part of that document. But for
        // NDJSON (newline-separated top-level documents - see AWAIT_DOC_*
        // above) one malformed line must not permanently take down every
        // later, individually-valid one. On the next newline, resync: treat
        // it exactly like the separator it already is between two NDJSON
        // records, abandon whatever was left of the failed document, and
        // start fresh as if a new document begins right after it - see
        // resyncAfterError(). Until (or unless) a newline shows up, this is
        // byte-for-byte the original issue #5 fix: every iteration just
        // `continue`s (i is only ever incremented by the enclosing `for`,
        // never rewound), so forward progress through the buffer is
        // unconditionally guaranteed and the ERROR state can never spin -
        // resyncing out of it earlier, on a newline, only reaches that same
        // guaranteed-forward-progress `continue` sooner, never a rewind.
        if (buffer[i] === 0x0a) { // `\n`
          this.resyncAfterError();
        }
        continue;
      case START:
        n = buffer[i];
        switch (n) {
        case 0x7b: // `{`
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.pushContainer(FRAME_OBJECT);
          this.callbacks.onStartObject();
          continue;
        case 0x7d: // `}`
          if (!this.canCloseObject()) {
            this.structuralError(buffer, i, 'a matching "{" (or a key/value was still expected)');
            continue;
          }
          this.popContainer();
          this.callbacks.onEndObject();
          continue;
        case 0x5b: // `[`
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.pushContainer(FRAME_ARRAY);
          this.callbacks.onStartArray();
          continue;
        case 0x5d: // `]`
          if (!this.canCloseArray()) {
            this.structuralError(buffer, i, 'a matching "[" (or a value was still expected)');
            continue;
          }
          this.popContainer();
          this.callbacks.onEndArray();
          continue;
        case 0x3a: // `:`
          if (this.awaiting !== AWAIT_OBJECT_COLON) {
            this.structuralError(buffer, i, '":" only legal right after an object key');
            continue;
          }
          this.awaiting = AWAIT_OBJECT_VALUE;
          this.callbacks.onColon();
          continue;
        case 0x2c: // `,`
          if (!this.tryComma()) {
            this.structuralError(buffer, i, '"," only legal between array/object elements');
            continue;
          }
          this.callbacks.onComma();
          continue;
        case 0x74: // `t`
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.enterValue();
          this.state = TRUE1;
          continue;
        case 0x66: // `f`
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.enterValue();
          this.state = FALSE1;
          continue;
        case 0x6e: // `n`
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.enterValue();
          this.state = NULL1;
          continue;
        case 0x22: // `"`
          if (this.expectingKey()) {
            this.enterKey();
          } else if (this.expectingValue()) {
            this.enterValue();
          } else {
            this.structuralError(buffer, i, 'a value, "}"/"]", or ","');
            continue;
          }
          this.str = '';
          this.state = TDQSTR1;
          continue;
        case 0x2d: // `-`
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.enterValue();
          this.negative = true;
          this.state = NUMBER1;
          continue;
        case 0x30: // `0`
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.enterValue();
          this.magnatude = 0;
          this.state = NUMBER2;
          continue;
        }
        if (n > 0x30 && n <= 0x39) { // 1-9
          if (!this.requireValuePosition(buffer, i)) { continue; }
          this.enterValue();
          this.magnatude = n - 0x30;
          this.state = NUMBER3;
          continue;
        }
        if (n === 0x20 || n === 0x09 || n === 0x0a || n === 0x0d) {
          if (this.awaiting === AWAIT_DOC_AFTER_VALUE) {
            // A separator between two top-level (NDJSON) values - ready
            // for the next one now.
            this.awaiting = AWAIT_DOC_VALUE;
          }
          continue; // whitespace
        }
        this.charError(buffer, i);
        continue;
      case TDQSTR1:
        n = buffer[i];
        if (n !== 0x22) {
          i--;
          this.state = STRING1;
        } else {
          this.state = TDQSTR2;
        }
        continue;
      case TDQSTR2:
        n = buffer[i];
        if (n !== 0x22) {
          i--;
          this.callbacks.onString('');
          this.str = undefined;
          this.state = START;
        } else {
          this.tdq = true;
          this.state = STRING1;
        }
        continue;
      case TDQSTR3: case TDQSTR4: case TDQSTR5:
        n = buffer[i];
        if (n === 0x22) {
          this.state++;
          continue;
        } else {
          i--;
          this.str += '"';
          if (this.state === TDQSTR5) {
            this.str += '"';
          }
        }
        this.state = STRING1;
        continue;
      case TDQSTR6:
        i--;
        this.tdq = false;
        this.callbacks.onString(this.str);
        this.str = undefined;
        this.state = START;
        continue;
      case STRING1: // After open quote
        n = buffer[i];
        switch (n) {
        case 0x22: // `"`
          // A `"` byte can never be a legal UTF-8 continuation byte (those
          // are always in 0x80-0xBF), so it always terminates whatever
          // multi-byte sequence was in progress. Flush it (as U+FFFD, same
          // as any other malformed sequence) before deciding what the quote
          // itself means, or the pending bytes would be silently dropped.
          this.flushIncompleteUtf8();
          if (!this.tdq) {
            this.callbacks.onString(this.str);
            this.str = undefined;
            this.state = START;
            continue;
          } else if (this.tdq) {
            i--;
            this.state = TDQSTR3;
            continue;
          }
          this.charError(buffer, i);
          continue;
        case 0x5c: // `\`
          if (!this.tdq) {
            // Same reasoning as the `"` case above: `\` (0x5c) is never a
            // valid continuation byte.
            this.flushIncompleteUtf8();
            this.state = STRING2;
            continue;
          }
        }
        if (n >= 0x20 || ((n === 13 || n === 10) && this.tdq)) {
          this.appendUtf8Byte(n);
          continue;
        }
        this.charError(buffer, i);
        continue;
      case STRING2: // After backslash
        n = buffer[i];
        switch (n) {
        case 0x22: this.str += '"'; this.state = STRING1; continue;
        case 0x5c: this.str += '\\'; this.state = STRING1; continue;
        case 0x2f: this.str += '\/'; this.state = STRING1; continue;
        case 0x62: this.str += '\b'; this.state = STRING1; continue;
        case 0x66: this.str += '\f'; this.state = STRING1; continue;
        case 0x6e: this.str += '\n'; this.state = STRING1; continue;
        case 0x72: this.str += '\r'; this.state = STRING1; continue;
        case 0x74: this.str += '\t'; this.state = STRING1; continue;
        case 0x75: this.unicode = ''; this.state = STRING3; continue;
        }
        this.charError(buffer, i);
        continue;
      case STRING3: case STRING4: case STRING5: case STRING6: // unicode hex codes
        n = buffer[i];
        // 0-9 A-F a-f
        if ((n >= 0x30 && n <= 0x39) || (n > 0x40 && n <= 0x46) || (n > 0x60 && n <= 0x66)) {
          this.unicode += String.fromCharCode(n);
          if (this.state++ === STRING6) {
            this.str += String.fromCharCode(parseInt(this.unicode, 16));
            this.unicode = undefined;
            this.state = STRING1;
          }
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NUMBER1: // after minus
        n = buffer[i];
        if (n === 0x30) { // `0`
          this.magnatude = 0;
          this.state = NUMBER2;
          continue;
        }
        if (n > 0x30 && n <= 0x39) { // `1`-`9`
          this.magnatude = n - 0x30;
          this.state = NUMBER3;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NUMBER2: // * After initial zero
        n = buffer[i];
        switch (n) {
        case 0x2e: // .
          this.position = 0.1; this.state = NUMBER4; continue;
        case 0x65: case 0x45: // e/E
          this.exponent = 0; this.state = NUMBER6; continue;
        }
        if (n >= 0x30 && n <= 0x39) { // 0-9: a digit right after a lone
          // leading zero (e.g. "01") is disallowed - RFC 8259's grammar is
          // `int = zero / ( digit1-9 *DIGIT )`, so a leading zero may only
          // be followed by `.`, `e`/`E`, or the end of the number, never
          // another digit.
          this.charError(buffer, i);
          continue;
        }
        this.flushPendingNumber();
        i--; // rewind to re-check this char
        continue;
      case NUMBER3: // * After digit (before period)
        n = buffer[i];
        switch (n) {
        case 0x2e: // .
          this.position = 0.1; this.state = NUMBER4; continue;
        case 0x65: case 0x45: // e/E
          this.exponent = 0; this.state = NUMBER6; continue;
        }
        if (n >= 0x30 && n <= 0x39) { // 0-9
          this.magnatude = this.magnatude * 10 + (n - 0x30);
          continue;
        }
        this.flushPendingNumber();
        i--; // rewind to re-check
        continue;
      case NUMBER4: // After period
        n = buffer[i];
        if (n >= 0x30 && n <= 0x39) { // 0-9
          this.magnatude += this.position * (n - 0x30);
          this.position /= 10;
          this.state = NUMBER5;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NUMBER5: // * After digit (after period)
        n = buffer[i];
        if (n >= 0x30 && n <= 0x39) { // 0-9
          this.magnatude += this.position * (n - 0x30);
          this.position /= 10;
          continue;
        }
        if (n === 0x65 || n === 0x45) { // E/e
          this.exponent = 0;
          this.state = NUMBER6;
          continue;
        }
        this.flushPendingNumber();
        i--; // rewind
        continue;
      case NUMBER6: // After E
        n = buffer[i];
        if (n === 0x2b || n === 0x2d) { // +/-
          if (n === 0x2d) { this.negativeExponent = true; }
          this.state = NUMBER7;
          continue;
        }
        if (n >= 0x30 && n <= 0x39) {
          this.exponent = this.exponent * 10 + (n - 0x30);
          this.state = NUMBER8;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NUMBER7: // After +/-
        n = buffer[i];
        if (n >= 0x30 && n <= 0x39) { // 0-9
          this.exponent = this.exponent * 10 + (n - 0x30);
          this.state = NUMBER8;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NUMBER8: // * After digit (after +/-)
        n = buffer[i];
        if (n >= 0x30 && n <= 0x39) { // 0-9
          this.exponent = this.exponent * 10 + (n - 0x30);
          continue;
        }
        this.flushPendingNumber();
        i--;
        continue;
      case TRUE1: // r
        if (buffer[i] === 0x72) {
          this.state = TRUE2;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case TRUE2: // u
        if (buffer[i] === 0x75) {
          this.state = TRUE3;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case TRUE3: // e
        if (buffer[i] === 0x65) {
          this.state = START;
          this.callbacks.onBoolean(true);
          continue;
        }
        this.charError(buffer, i);
        continue;
      case FALSE1: // a
        if (buffer[i] === 0x61) {
          this.state = FALSE2;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case FALSE2: // l
        if (buffer[i] === 0x6c) {
          this.state = FALSE3;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case FALSE3: // s
        if (buffer[i] === 0x73) {
          this.state = FALSE4;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case FALSE4: // e
        if (buffer[i] === 0x65) {
          this.state = START;
          this.callbacks.onBoolean(false);
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NULL1: // u
        if (buffer[i] === 0x75) {
          this.state = NULL2;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NULL2: // l
        if (buffer[i] === 0x6c) {
          this.state = NULL3;
          continue;
        }
        this.charError(buffer, i);
        continue;
      case NULL3: // l
        if (buffer[i] === 0x6c) {
          this.state = START;
          this.callbacks.onNull();
          continue;
        }
        this.charError(buffer, i);
        continue;
      }
    }
  }

  // Flushes a number token that has already reached a "valid to stop here"
  // state (NUMBER2/3/5/8), firing onNumber and returning the tokenizer to
  // START. Used in two different situations: by finish() below, once the
  // stream has genuinely ended, and internally by parse() itself (the
  // `this.flushPendingNumber(); i--;` pattern in the NUMBER2/3/5/8 cases)
  // whenever a *non*-digit terminator ends a number mid-stream - e.g. the
  // `]` in "[123]" - so the ordinary onNumber callback fires before that
  // terminator byte gets reprocessed from the top. Splitting this out from
  // finish() matters: finish() also runs the *structural* end-of-stream
  // checks below, which must only ever run for a genuine end of input, not
  // for this purely-internal mid-stream reuse (a mid-parse call happens
  // with the array/object the number lives in still legitimately open on
  // structStack). Does nothing if the tokenizer isn't currently parked in
  // one of those four states.
  private flushPendingNumber(): void {
    switch (this.state) {
    case NUMBER2: // * After initial zero
      this.callbacks.onNumber(0);
      this.state = START;
      this.magnatude = undefined;
      this.negative = undefined;
      break;
    case NUMBER3: // * After digit (before period)
      this.state = START;
      if (this.negative) {
        this.magnatude = -this.magnatude;
        this.negative = undefined;
      }
      this.callbacks.onNumber(this.magnatude);
      this.magnatude = undefined;
      break;
    case NUMBER5: // * After digit (after period)
      this.state = START;
      if (this.negative) {
        this.magnatude = -this.magnatude;
        this.negative = undefined;
      }
      this.callbacks.onNumber(this.negative ? -this.magnatude : this.magnatude);
      this.magnatude = undefined;
      this.position = undefined;
      break;
    case NUMBER8: // * After digit (after +/-)
      if (this.negativeExponent) {
        this.exponent = -this.exponent;
        this.negativeExponent = undefined;
      }
      this.magnatude *= Math.pow(10, this.exponent);
      this.exponent = undefined;
      if (this.negative) {
        this.magnatude = -this.magnatude;
        this.negative = undefined;
      }
      this.state = START;
      this.callbacks.onNumber(this.magnatude);
      this.magnatude = undefined;
      break;
    }
  }

  finish() {
    if (this.state === ERROR) {
      // The single onError for the actual failure was already emitted;
      // don't also report a misleading "end of input" error on top of it.
      return;
    }
    this.flushPendingNumber();
    if (this.state !== START) {
      this.callbacks.onError(new Error('Unexpected end of input stream'));
      return;
    }
    // Token-level state is clean (no number/string/literal left mid-parse) -
    // now check *structural* completeness: every `[`/`{` dispatched must
    // have been matched by a `]`/`}` by now, and at least one top-level
    // value must have been seen (an empty, or whitespace-only, document has
    // no value at all - RFC 8259 also requires exactly one).
    if (this.structStack.length > 0) {
      this.state = ERROR;
      this.callbacks.onError(new Error('Unexpected end of input stream: unclosed array/object'));
      return;
    }
    // `!this.hadError` guards this the same way `this.state === ERROR` is
    // guarded against above: a stream that resynced after an error (see
    // resyncAfterError()) is back in `state === START` by the time it hits
    // EOF, so the check above no longer catches it, but it must still not
    // be treated as an "empty document" - it already got exactly one real
    // error for the record that actually failed, and finish() must not
    // pile a second, misleading one on top just because no further NDJSON
    // record happened to arrive before the stream ended.
    if (this.awaiting === AWAIT_DOC_VALUE && !this.sawValue && !this.hadError) {
      this.state = ERROR;
      this.callbacks.onError(new Error('Unexpected end of input stream: no data'));
    }
  }

  // Recovery point for the ERROR state's NDJSON resync (see the `case
  // ERROR:` branch in parse() above): puts every piece of token- and
  // structural-level state back to exactly what the constructor leaves it
  // in, so the next byte is parsed as if a brand new JsonSaxParser had just
  // started - abandoning anything left over from the document that failed
  // (an open string/number token, an open array/object on structStack,
  // etc.), which can never be trusted to mean anything once its own parse
  // was aborted mid-way.
  //
  // Deliberately leaves `sawValue` and `hadError` untouched: both are
  // whole-stream bookkeeping (has *any* top-level value ever completed; has
  // *any* error ever been reported), not per-document state, so a resync
  // must not reset them any more than completing an ordinary NDJSON record
  // does.
  private resyncAfterError(): void {
    this.state = START;
    this.str = undefined;
    this.unicode = undefined;
    this.negative = undefined;
    this.magnatude = undefined;
    this.position = undefined;
    this.exponent = undefined;
    this.negativeExponent = undefined;
    this.tdq = false;
    this.resetUtf8Decoder();
    this.awaiting = AWAIT_DOC_VALUE;
    this.structStack = [];
    this.callbacks.onResync?.();
  }

  // Feeds one raw content byte from a JSON string into the UTF-8 decoder and
  // appends whatever it produces (zero or more UTF-16 code units) to
  // `this.str`. Only handles the *raw* literal-byte path - `\uXXXX` escapes
  // (STRING2/STRING3-6) already decode correctly on their own and never
  // reach this method.
  //
  // Malformed input (an invalid lead byte, an out-of-range continuation
  // byte, an overlong encoding, or a lead byte for a code point above
  // U+10FFFF) is not itself defined by RFC 8259 (JSON requires valid
  // Unicode text) - JSONTestSuite files these under i_string_* as
  // "implementation-defined". This follows the same best-effort recovery
  // as the WHATWG UTF-8 decoder algorithm
  // (https://encoding.spec.whatwg.org/#utf-8-decoder), the same one
  // `Buffer#toString('utf8')` and `TextDecoder` use: substitute one U+FFFD
  // REPLACEMENT CHARACTER per malformed byte (or run of bytes that turned
  // out not to form a valid sequence), and resynchronize on the next byte,
  // rather than throwing and aborting the whole parse. That keeps a single
  // stray non-UTF-8 byte from taking down parsing of an otherwise-valid
  // document, while staying fully deterministic - the same malformed input
  // always produces the same output.
  private appendUtf8Byte(n: number): void {
    for (;;) {
      if (this.utf8BytesNeeded === 0) {
        if (n < 0x80) { // 1-byte (ASCII)
          this.str += String.fromCharCode(n);
        } else if (n >= 0xc2 && n <= 0xdf) { // 2-byte lead
          this.utf8BytesNeeded = 1;
          this.utf8CodePoint = n & 0x1f;
        } else if (n >= 0xe0 && n <= 0xef) { // 3-byte lead
          if (n === 0xe0) { this.utf8LowerBoundary = 0xa0; } // reject overlong
          if (n === 0xed) { this.utf8UpperBoundary = 0x9f; } // reject encoded surrogates
          this.utf8BytesNeeded = 2;
          this.utf8CodePoint = n & 0x0f;
        } else if (n >= 0xf0 && n <= 0xf4) { // 4-byte lead
          if (n === 0xf0) { this.utf8LowerBoundary = 0x90; } // reject overlong
          if (n === 0xf4) { this.utf8UpperBoundary = 0x8f; } // reject > U+10FFFF
          this.utf8BytesNeeded = 3;
          this.utf8CodePoint = n & 0x07;
        } else {
          // 0x80-0xbf (stray continuation byte used as a lead byte),
          // 0xc0/0xc1 (only ever produce overlong encodings), or
          // 0xf5-0xff (would encode past U+10FFFF): never valid.
          this.str += '�';
        }
        return;
      }
      // Mid-sequence: `n` should be the next continuation byte.
      if (n < this.utf8LowerBoundary || n > this.utf8UpperBoundary) {
        // Not a valid continuation byte - the sequence so far is malformed.
        // Emit one replacement character for it, then reprocess `n` from
        // scratch: it belongs to whatever comes next, not to the aborted
        // sequence (e.g. an aborted 2-byte lead immediately followed by a
        // plain ASCII letter must not swallow that letter).
        this.resetUtf8Decoder();
        this.str += '�';
        continue;
      }
      // Only the first continuation byte after certain lead bytes is
      // range-restricted (to reject overlong encodings / surrogates);
      // widen back to the standard continuation range for the rest.
      this.utf8LowerBoundary = 0x80;
      this.utf8UpperBoundary = 0xbf;
      this.utf8CodePoint = (this.utf8CodePoint << 6) | (n & 0x3f);
      this.utf8BytesSeen++;
      if (this.utf8BytesSeen < this.utf8BytesNeeded) {
        return;
      }
      const codePoint = this.utf8CodePoint;
      this.resetUtf8Decoder();
      // A 4-byte sequence decodes to a code point outside the BMP;
      // fromCodePoint automatically encodes that as a UTF-16 surrogate pair.
      this.str += String.fromCodePoint(codePoint);
      return;
    }
  }

  // A `"` or `\` byte encountered while a multi-byte UTF-8 sequence is
  // still in progress can never be that sequence's continuation byte (both
  // are ASCII, and continuation bytes are always 0x80-0xBF), so the
  // sequence is malformed/truncated. Emit one replacement character for it
  // and reset the decoder before handling the `"`/`\` itself.
  private flushIncompleteUtf8(): void {
    if (this.utf8BytesNeeded > 0) {
      this.resetUtf8Decoder();
      this.str += '�';
    }
  }

  private resetUtf8Decoder(): void {
    this.utf8CodePoint = 0;
    this.utf8BytesSeen = 0;
    this.utf8BytesNeeded = 0;
    this.utf8LowerBoundary = 0x80;
    this.utf8UpperBoundary = 0xbf;
  }

  private charError(buffer: Buffer, i: number): void {
    if (this.state === ERROR) {
      // Already reported; never emit a second error for the same failure.
      return;
    }
    const stateName = toknam(this.state);
    this.state = ERROR;
    this.hadError = true;
    this.callbacks.onError(new Error('Unexpected ' + JSON.stringify(String.
      fromCharCode(buffer[i])) + ' at position ' + i + ' in state ' + stateName));
  }

  // Same terminal-error mechanism as charError() above (same ERROR state,
  // same onError callback, so callers see one consistent error path
  // regardless of whether a violation was a malformed token or a
  // structural/grammar one) - just a message describing what the grammar
  // expected here instead of a raw tokenizer state name, since a
  // structural violation is always caught in the START state (which isn't
  // itself informative about what went wrong).
  private structuralError(buffer: Buffer, i: number, expected: string): void {
    if (this.state === ERROR) {
      return;
    }
    this.state = ERROR;
    this.hadError = true;
    this.callbacks.onError(new Error('Unexpected ' + JSON.stringify(String.
      fromCharCode(buffer[i])) + ' at position ' + i + ': expected ' + expected));
  }
}

export namespace JsonSaxParser {
  export interface ICallbacks {
    onBoolean: (bool: boolean) => void;
    onColon: () => void;
    onComma: () => void;
    onEndArray: () => void;
    onEndObject: () => void;
    onNull: () => void;
    onNumber: (num: number) => void;
    onStartArray: () => void;
    onStartObject: () => void;
    onString: (str: string) => void;
    onError: (err: Error) => void;
    // Fired once, right after resyncAfterError() puts the tokenizer itself
    // back to a fresh-document state on an NDJSON resync (see the `case
    // ERROR:` branch in parse()) - i.e. after onError already reported the
    // failed record's own error, and before any callback for the next
    // record fires. Optional (and a no-op if omitted) for backward
    // compatibility with any existing ICallbacks implementation that
    // predates NDJSON resync support - such a caller simply keeps the
    // pre-resync, ERROR-is-terminal behavior it always had, since it also
    // won't have anything of its own to reset here.
    //
    // A consumer that tracks its own structural state alongside the parser
    // (as StreamContext does - see its own resyncAfterError()) needs this:
    // JsonSaxParser resetting *its* nesting/token state is not enough to
    // make a downstream consumer treat the next record as a fresh
    // document if that consumer was never told the previous one got
    // abandoned mid-parse - it would otherwise keep thinking whatever
    // array/object the failed record left half-open is still open.
    onResync?: () => void;
  }
}
