// AssemblyScript stage-1 structural scanner prototype (simdjson-style).
// Given JSON bytes at INPUT_PTR in linear memory, writes u32 positions of
// unescaped structural characters ({ } [ ] : , ") to OUTPUT_PTR, with
// quote/escape state maintained across chunks. Returns the index count.
//
// scanSimd: v128 (WASM SIMD) implementation - 64 bytes per outer iteration.
// scanScalar: plain byte-loop implementation with identical output, to
// isolate "SIMD win" from "WASM vs JS" and "less work than full tokenizer".

export const INPUT_PTR: i32 = 0x20000;  // 128KB in: room for a 64KB chunk (+pad)
export const OUTPUT_PTR: i32 = 0x40000; // 256KB in: room for 64K u32 indices

// ---- cross-chunk state ----
let prevInString: u64 = 0; // all-ones if chunk ended inside a string
let prevEscaped: u64 = 0;  // 1 if chunk's last byte was an escaping backslash
// scalar variant state
let sInString: bool = false;
let sEscaped: bool = false;

export function reset(): void {
  prevInString = 0;
  prevEscaped = 0;
  sInString = false;
  sEscaped = false;
}

const ODD_BITS: u64 = 0xAAAAAAAAAAAAAAAA;
const EVEN_BITS: u64 = 0x5555555555555555;

// simdjson's find_escaped: bitmask of characters escaped by a backslash,
// handling runs of backslashes and the cross-block carry.
// @ts-ignore: decorator
@inline
function findEscaped(backslash: u64): u64 {
  if (!backslash) {
    const r = prevEscaped;
    prevEscaped = 0;
    return r;
  }
  backslash &= ~prevEscaped;
  const followsEscape: u64 = (backslash << 1) | prevEscaped;
  const oddSequenceStarts: u64 = backslash & ODD_BITS & ~followsEscape;
  const sequencesStartingOnEvenBits: u64 = oddSequenceStarts + backslash;
  prevEscaped = sequencesStartingOnEvenBits < backslash ? 1 : 0; // carry out
  const invertMask: u64 = sequencesStartingOnEvenBits << 1;
  return (EVEN_BITS ^ invertMask) & followsEscape;
}

// prefix-XOR over a 64-bit mask (simdjson uses PCLMULQDQ; WASM has no
// carry-less multiply, so use the 6-step shift-xor ladder).
// @ts-ignore: decorator
@inline
function prefixXor(x: u64): u64 {
  x ^= x << 1;
  x ^= x << 2;
  x ^= x << 4;
  x ^= x << 8;
  x ^= x << 16;
  x ^= x << 32;
  return x;
}

// Build one 16-bit lane-mask for 16 input bytes: quote / backslash /
// structural ({ } [ ] : ,). Returns them packed via out-params emulated
// with globals (AS has no multi-return); cheaper: compute per 16B and OR
// into u64s at the call site.

// len must be a multiple of 64 (caller pads with spaces).
export function scanSimd(len: i32): i32 {
  let out: i32 = OUTPUT_PTR;
  const vQuote = i8x16.splat(0x22);
  const vBackslash = i8x16.splat(0x5c);
  const vOpenBrace = i8x16.splat(0x7b);
  const vCloseBrace = i8x16.splat(0x7d);
  const vOpenBracket = i8x16.splat(0x5b);
  const vCloseBracket = i8x16.splat(0x5d);
  const vColon = i8x16.splat(0x3a);
  const vComma = i8x16.splat(0x2c);

  for (let base: i32 = 0; base < len; base += 64) {
    let quoteM: u64 = 0;
    let bsM: u64 = 0;
    let structM: u64 = 0;
    // 4 x 16-byte vectors -> three 64-bit masks
    for (let k: i32 = 0; k < 64; k += 16) {
      const v = v128.load(INPUT_PTR + base + k);
      const q: u64 = <u64><u32>i8x16.bitmask(i8x16.eq(v, vQuote));
      const b: u64 = <u64><u32>i8x16.bitmask(i8x16.eq(v, vBackslash));
      const s: u64 = <u64><u32>i8x16.bitmask(
        v128.or(
          v128.or(
            v128.or(i8x16.eq(v, vOpenBrace), i8x16.eq(v, vCloseBrace)),
            v128.or(i8x16.eq(v, vOpenBracket), i8x16.eq(v, vCloseBracket))),
          v128.or(i8x16.eq(v, vColon), i8x16.eq(v, vComma))));
      quoteM |= q << k;
      bsM |= b << k;
      structM |= s << k;
    }
    const escaped: u64 = findEscaped(bsM);
    const quote: u64 = quoteM & ~escaped;
    const inString: u64 = prefixXor(quote) ^ prevInString;
    // sign-extend the top bit: were we inside a string at block end?
    prevInString = <u64>(<i64>inString >> 63);
    // structural chars outside strings, plus the (unescaped) quotes themselves.
    // NB: inString marks the opening quote itself as "inside", the closing
    // quote as "outside" - OR-ing `quote` back emits both delimiters.
    let emit: u64 = (structM & ~inString) | quote;
    while (emit) {
      const idx: i32 = <i32>ctz(emit);
      store<u32>(out, <u32>(base + idx));
      out += 4;
      emit &= emit - 1;
    }
  }
  return (out - OUTPUT_PTR) >> 2;
}

// Identical semantics, plain byte loop (no v128). len need not be padded.
export function scanScalar(len: i32): i32 {
  let out: i32 = OUTPUT_PTR;
  let inStr = sInString;
  let esc = sEscaped;
  for (let i: i32 = 0; i < len; i++) {
    const c: i32 = load<u8>(INPUT_PTR + i);
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === 0x5c) {
        esc = true;
      } else if (c === 0x22) {
        store<u32>(out, <u32>i);
        out += 4;
        inStr = false;
      }
    } else if (c === 0x22) {
      store<u32>(out, <u32>i);
      out += 4;
      inStr = true;
    } else if (c === 0x7b || c === 0x7d || c === 0x5b || c === 0x5d ||
               c === 0x3a || c === 0x2c) {
      store<u32>(out, <u32>i);
      out += 4;
    }
  }
  sInString = inStr;
  sEscaped = esc;
  return (out - OUTPUT_PTR) >> 2;
}
