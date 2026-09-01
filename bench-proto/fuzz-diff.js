// Differential fuzz: baseline JsonSaxParser (dist-baseline) vs prototype
// (dist). Records the complete callback stream (incl. error messages,
// onResync, onValueBoundary ordering) and compares deep-equal for every
// input under every chunking. Usage: node fuzz-diff.js [iterations]
'use strict';
const { JsonSaxParser: Base } = require('../dist-baseline/main/lib/utils/JsonSaxParser.js');
const { JsonSaxParser: Proto } = require('../dist/main/lib/utils/JsonSaxParser.js');

function run(Parser, chunks) {
  const ev = [];
  const p = new Parser({
    onBoolean: (b) => ev.push(['bool', b]),
    onColon: () => ev.push(['colon']),
    onComma: () => ev.push(['comma']),
    onEndArray: () => ev.push(['endArr']),
    onEndObject: () => ev.push(['endObj']),
    onNull: () => ev.push(['null']),
    onNumber: (x) => ev.push(['num', x, Object.is(x, -0) ? 'negzero' : '']),
    onStartArray: () => ev.push(['startArr']),
    onStartObject: () => ev.push(['startObj']),
    onString: (s) => ev.push(['str', s]),
    onError: (e) => ev.push(['err', e.message]),
    onResync: () => ev.push(['resync']),
    onValueBoundary: () => ev.push(['vb']),
  });
  try {
    for (const c of chunks) { p.parse(c); }
    p.finish();
  } catch (e) {
    ev.push(['thrown', String(e && e.message)]);
  }
  return ev;
}

let cases = 0;
let failures = 0;
function check(label, chunks) {
  cases++;
  const a = run(Base, chunks);
  const b = run(Proto, chunks);
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) {
    failures++;
    console.error('MISMATCH:', label);
    console.error('  input(hex):', Buffer.concat(chunks).toString('hex'));
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = JSON.stringify(a[i]); const y = JSON.stringify(b[i]);
      if (x !== y) { console.error(`  ev[${i}] base=${x} proto=${y}`); }
    }
    if (failures > 20) { console.error('too many failures, aborting'); process.exit(1); }
  }
}

// Check a doc unchunked, split at EVERY single offset (2 chunks), plus a few
// 3-way splits, plus byte-at-a-time.
function checkAllSplits(label, doc) {
  const buf = Buffer.isBuffer(doc) ? doc : Buffer.from(doc, 'binary');
  check(label + ' [whole]', [buf]);
  for (let i = 1; i < buf.length; i++) {
    check(`${label} [split@${i}]`, [buf.subarray(0, i), buf.subarray(i)]);
  }
  for (let i = 1; i + 1 < buf.length; i += 3) {
    for (let j = i + 1; j < buf.length; j += 2) {
      check(`${label} [split@${i},${j}]`, [buf.subarray(0, i), buf.subarray(i, j), buf.subarray(j)]);
    }
  }
  const bytes = [];
  for (let i = 0; i < buf.length; i++) { bytes.push(buf.subarray(i, i + 1)); }
  check(label + ' [byte-at-a-time]', bytes);
}

// ---------- adversarial corpus ----------
const B = (...xs) => Buffer.concat(xs.map((x) => Buffer.isBuffer(x) ? x : Buffer.from(x, 'binary')));
const adversarial = [
  // escapes, every one
  ['escapes', '"a\\" \\\\ \\/ \\b \\f \\n \\r \\t z"'],
  ['esc-only', '"\\\\"'],
  ['esc-bad', '"a\\qb"'],
  // \uXXXX: BMP, surrogate pair, lone high, lone low, mixed case hex, bad hex
  ['u-bmp', '"\\u00e9\\u0041"'],
  ['u-pair', '"\\ud83d\\ude00"'],
  ['u-lone-high', '"\\ud800x"'],
  ['u-lone-low', '"\\udc00x"'],
  ['u-hexcase', '"\\uAbCd"'],
  ['u-badhex', '"\\u12g4"'],
  ['u-trunc-eof', '"\\u12'],
  // raw UTF-8: 2/3/4-byte, boundary code points
  ['utf8-2b', B('"', Buffer.from('é', 'utf8'), '"')],
  ['utf8-3b', B('"', Buffer.from('€￿', 'utf8'), '"')],
  ['utf8-4b', B('"', Buffer.from('😀\u{10FFFF}', 'utf8'), '"')],
  ['utf8-mixed', B('"a', Buffer.from('é', 'utf8'), 'b', Buffer.from('😀', 'utf8'), 'c"')],
  // invalid UTF-8
  ['utf8-stray-cont', B('"a', Buffer.from([0x80]), 'b"')],
  ['utf8-c0c1', B('"', Buffer.from([0xc0, 0xaf, 0xc1, 0x81]), '"')],
  ['utf8-overlong-e0', B('"', Buffer.from([0xe0, 0x80, 0xaf]), '"')],
  ['utf8-surrogate-enc', B('"', Buffer.from([0xed, 0xa0, 0x80]), '"')],
  ['utf8-f5', B('"', Buffer.from([0xf5, 0x90, 0x80, 0x80]), '"')],
  ['utf8-ff', B('"', Buffer.from([0xff, 0xfe]), '"')],
  ['utf8-trunc-quote', B('"', Buffer.from([0xe2, 0x82]), '"')],   // truncated 3-byte then closing quote
  ['utf8-trunc-bslash', B('"', Buffer.from([0xc3]), '\\n"')],     // truncated then escape
  ['utf8-trunc-eof', B('"abc', Buffer.from([0xf0, 0x9f]))],       // truncated at EOF (unterminated string)
  ['utf8-cont-after-ascii', B('"', Buffer.from([0xc3, 0x28]), '"')], // bad continuation = ASCII '('
  ['utf8-f0-lower', B('"', Buffer.from([0xf0, 0x80, 0x80, 0x80]), '"')],
  ['utf8-f4-upper', B('"', Buffer.from([0xf4, 0x90, 0x80, 0x80]), '"')],
  // triple-quote extension
  ['tdq-basic', '"""hello"""'],
  ['tdq-with-quotes', '"""a"b""c"""'],
  ['tdq-newlines', '"""a\nb\r\nc"""'],
  ['tdq-backslash', '"""a\\nb"""'],   // backslash literal inside tdq
  ['tdq-empty', '""""""'],
  ['tdq-four-quotes', '""""'],
  ['tdq-five-quotes', '"""""'],
  ['tdq-utf8', B('"""', Buffer.from('é😀', 'utf8'), '"""')],
  ['tdq-invalid-utf8', B('"""a', Buffer.from([0x80, 0xc3]), 'b"""')],
  ['tdq-unterminated', '"""abc'],
  ['tdq-ctrl', '"""a\x01b"""'],
  ['empty-str', '""'],
  ['empty-str-nl', '""\n'],
  ['two-empty', '"" ""'],
  // numbers: precision, structure, truncation
  ['num-max', '1.7976931348623157e308'],
  ['num-min', '5e-324'],
  ['num-longdigits', '3.141592653589793238462643383279502884197169399375105820974944'],
  ['num-int', '[0,-0,1,-1,123456789012345678901234567890,10]'],
  ['num-exp', '[1e5,1E5,1e+5,1e-5,0e0,0.5e10,2.5E-7]'],
  ['num-leadzero', '01'],
  ['num-neg-leadzero', '-01'],
  ['num-bare-minus', '-'],
  ['num-trailing-dot', '1.'],
  ['num-dot-nodigit', '1.e5'],
  ['num-exp-nodigit', '1e'],
  ['num-exp-sign-nodigit', '1e+'],
  ['num-eof-int', '123'],
  ['num-eof-frac', '1.25'],
  ['num-eof-exp', '1e9'],
  ['num-then-ws', '123 '],
  ['num-in-arr', '[1,2.5,3e7]'],
  ['num-overflow', '1.5e+9999'],
  ['num-underflow', '1.5e-9999'],
  // BOM
  ['bom-doc', B(Buffer.from([0xef, 0xbb, 0xbf]), '{"a":1}')],
  ['bom-only', Buffer.from([0xef, 0xbb, 0xbf])],
  ['bom-partial1', Buffer.from([0xef])],
  ['bom-partial2', Buffer.from([0xef, 0xbb])],
  ['bom-partial-then-json', B(Buffer.from([0xef]), '1')],
  ['bom-mid-stream', B('1\n', Buffer.from([0xef, 0xbb, 0xbf]), '2\n')],
  ['bom-double', B(Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), '1')],
  // NDJSON + resync
  ['ndjson-ok', '{"a":1}\n{"b":2}\n'],
  ['ndjson-bad-middle', '{"a":1}\n{bad\n{"b":2}\n'],
  ['ndjson-bad-at-nl', '{"a":\n{"b":2}\n'],
  ['ndjson-trunc-num', '12x\n34\n'],
  ['ndjson-two-errors', '{x\n[1,\n"ok"\n'],
  ['ndjson-str-then-bracket', '"abc"]'],
  ['ndjson-str-nl-bracket', '"abc"\n]'],
  ['ndjson-bare-strings', '"a"\n"b"\n"c"'],
  ['ndjson-crlf', '{"a":1}\r\n{"b":2}\r\n'],
  // structural errors
  ['struct-trailing-comma', '[1,]'],
  ['struct-colon-in-arr', '[1:2]'],
  ['struct-close-wrong', '[}'],
  ['struct-unclosed', '{"a":[1,2'],
  ['struct-double-comma', '[1,,2]'],
  ['struct-key-nonstring', '{1:2}'],
  ['struct-two-values', '1 2'],
  ['struct-empty-doc', ''],
  ['struct-ws-doc', '  \n '],
  ['literal-bad', '[tru]'],
  ['literal-truncated', 'tru'],
  ['literal-nul', 'nul'],
  ['literal-fals', 'fals'],
  // strings with control chars
  ['ctrl-in-str', '"a\x00b"'],
  ['ctrl-tab-in-str', '"a\tb"'],
  ['ctrl-nl-in-str', '"a\nb"'],
  ['str-del-char', '"a\x7fb"'],   // 0x7f allowed (>= 0x20)
  ['str-unterminated-eof', '"abc'],
  ['str-esc-at-eof', '"abc\\'],
  // deep-ish structure mixing everything
  ['kitchen-sink', '{"k1":"v1","k2":[1,2.5,true,false,null,{"n":"\\u00e9"},"""x"""],"k3":{"a":{"b":[]}}}'],
  ['long-ascii-str', '"' + 'abcdefghij'.repeat(50) + '"'],
  ['long-str-escapes', '"' + 'abc\\n'.repeat(40) + '"'],

  // ---- targeted additions: fast-path entry guard (ASCII arriving
  // mid-UTF-8-sequence) and the STRING1 fast path's 16-byte
  // latin1Slice/fromCharCode threshold + triple-quote span rules ----

  // ASCII byte immediately following an *aborted* multi-byte lead, for
  // every lead-byte class (2/3/4-byte), both with the ASCII run short
  // (below the slice threshold) and long (above it) so the fast path's
  // `utf8BytesNeeded === 0` entry guard is exercised right at the
  // boundary where a batch would otherwise have started.
  ['ascii-after-aborted-2byte-short', B('"', Buffer.from([0xc3]), 'ab"')],
  ['ascii-after-aborted-2byte-long', B('"', Buffer.from([0xc3]), 'abcdefghijklmnopqrstuvwxyz"')],
  ['ascii-after-aborted-3byte-short', B('"', Buffer.from([0xe2, 0x82]), 'ab"')],
  ['ascii-after-aborted-3byte-long', B('"', Buffer.from([0xe2, 0x82]), 'abcdefghijklmnopqrstuvwxyz"')],
  ['ascii-after-aborted-4byte-short', B('"', Buffer.from([0xf0, 0x9f, 0x98]), 'ab"')],
  ['ascii-after-aborted-4byte-long', B('"', Buffer.from([0xf0, 0x9f, 0x98]), 'abcdefghijklmnopqrstuvwxyz"')],
  // A long ASCII run (would batch) followed directly by a lead byte whose
  // continuation is itself immediately aborted by another ASCII run - two
  // fast-path batches sandwiching a broken sequence, back to back.
  ['ascii-sandwich-aborted-utf8', B('"abcdefghijklmnop', Buffer.from([0xe2, 0x28]), 'qrstuvwxyzabcdefg"')],
  // Lead byte split across a chunk boundary (only meaningful under
  // checkAllSplits, which tries every split point) immediately followed
  // by plain ASCII that must NOT fast-path (utf8BytesNeeded > 0 across
  // the chunk boundary).
  ['ascii-after-split-lead-2byte', B('"z', Buffer.from([0xc3]), 'q"')],
  ['ascii-after-split-lead-3byte', B('"z', Buffer.from([0xe2, 0x82]), 'q"')],
  // Valid multi-byte sequence immediately followed by a long ASCII run,
  // both short and long enough to cross the 16-byte slice threshold -
  // makes sure the fast path correctly re-engages right after
  // appendUtf8Byte() resets utf8BytesNeeded back to 0.
  ['ascii-after-valid-utf8-short', B('"', Buffer.from('é', 'utf8'), 'ab"')],
  ['ascii-after-valid-utf8-long', B('"', Buffer.from('é', 'utf8'), 'abcdefghijklmnopqrstuvwxyz"')],

  // STRING1 fast-path materialization threshold (`j - i >= 16`): exact
  // boundary runs, both plain and inside tdq mode, so an off-by-one in
  // the threshold or in either scan loop would show up as a length/content
  // mismatch rather than just a benign perf difference.
  ['ascii-run-len-15', '"' + 'a'.repeat(15) + '"'],
  ['ascii-run-len-16', '"' + 'a'.repeat(16) + '"'],
  ['ascii-run-len-17', '"' + 'a'.repeat(17) + '"'],
  ['tdq-run-len-15', '"""' + 'a'.repeat(15) + '"""'],
  ['tdq-run-len-16', '"""' + 'a'.repeat(16) + '"""'],
  ['tdq-run-len-17', '"""' + 'a'.repeat(17) + '"""'],

  // Digit-run batching (NUMBER3/5/8) threshold, same idea.
  ['num-digitrun-len-15', '1' + '2'.repeat(14)],
  ['num-digitrun-len-16', '1' + '2'.repeat(15)],
  ['num-digitrun-len-17', '1' + '2'.repeat(16)],
  ['num-frac-digitrun-16', '1.' + '2'.repeat(16)],
  ['num-exp-digitrun-16', '1e' + '2'.repeat(16)],

  // Triple-quote span rules: backslash-as-literal, embedded lone `"`, and
  // CR/LF-in-run all crossing the 16-byte threshold, since the tdq scan
  // loop duplicates the slow path's acceptance set in a place the two
  // could independently drift (per the issue's risk list).
  ['tdq-backslash-long-run', '"""' + 'a\\b'.repeat(10) + '"""'],
  ['tdq-single-quote-long-run', '"""' + 'a"b'.repeat(10) + '"""'],
  ['tdq-crlf-long-run', '"""' + 'line\r\n'.repeat(6) + '"""'],
  ['tdq-ctrl-long-run', '"""' + ('a'.repeat(14) + '\x01') + '"""'],
  // Fast path must not engage on the *closing* triple quote even when the
  // preceding content run is long enough to slice right up to it.
  ['tdq-long-then-close', '"""' + 'x'.repeat(20) + '"""'],
  // Escape sequence immediately preceded by a run long enough to slice.
  ['esc-after-long-run', '"' + 'a'.repeat(20) + '\\n"'],
];

for (const [label, doc] of adversarial) { checkAllSplits(label, doc); }

// ---------- randomized corpus ----------
let seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n) { return Math.floor(rnd() * n); }
function pick(a) { return a[ri(a.length)]; }

function randString() {
  const parts = ['"'];
  const kinds = ['ascii', 'esc', 'u', 'utf8', 'bad', 'quoteish'];
  const len = ri(8);
  for (let k = 0; k < len; k++) {
    switch (pick(kinds)) {
    case 'ascii': parts.push(Buffer.from('abc XYZ_09'.substr(ri(9), 1 + ri(3)), 'binary')); break;
    case 'esc': parts.push(Buffer.from(pick(['\\"', '\\\\', '\\/', '\\b', '\\f', '\\n', '\\r', '\\t']))); break;
    case 'u': parts.push(Buffer.from('\\u' + (0x1000 + ri(0xf000)).toString(16))); break;
    case 'utf8': parts.push(Buffer.from(pick(['é', '€', '😀', '߿', '￿', 'ब']), 'utf8')); break;
    case 'bad': parts.push(Buffer.from([pick([0x80, 0xbf, 0xc0, 0xc3, 0xe0, 0xed, 0xf0, 0xf4, 0xf5, 0xff])])); break;
    case 'quoteish': parts.push(Buffer.from(pick(['\x7f', ' ', '~', '!']))); break;
    }
  }
  parts.push('"');
  return Buffer.concat(parts.map((p) => Buffer.isBuffer(p) ? p : Buffer.from(p, 'binary')));
}
function randNumber() {
  return Buffer.from(pick(['0', '-0', '7', '123', '-45.67', '1e9', '2.5E-7', '0.001', '99999999999999999999', '1.7976931348623157e308', '5e-324']));
}
function randValue(depth) {
  const r = rnd();
  if (depth > 3 || r < 0.3) { return pick([randString(), randNumber(), Buffer.from('true'), Buffer.from('false'), Buffer.from('null')]); }
  if (r < 0.65) {
    const n = ri(4);
    const parts = [Buffer.from('[')];
    for (let k = 0; k < n; k++) { if (k) { parts.push(Buffer.from(',')); } parts.push(randValue(depth + 1)); }
    parts.push(Buffer.from(']'));
    return Buffer.concat(parts);
  }
  const n = ri(4);
  const parts = [Buffer.from('{')];
  for (let k = 0; k < n; k++) {
    if (k) { parts.push(Buffer.from(',')); }
    parts.push(randString(), Buffer.from(':'), randValue(depth + 1));
  }
  parts.push(Buffer.from('}'));
  return Buffer.concat(parts);
}

const ITER = +(process.argv[2] || 3000);
for (let it = 0; it < ITER; it++) {
  let doc = randValue(0);
  // NDJSON-ify some, corrupt some
  if (rnd() < 0.4) { doc = Buffer.concat([doc, Buffer.from('\n'), randValue(0), Buffer.from('\n'), randValue(0)]); }
  if (rnd() < 0.3) { // random byte mutation
    doc = Buffer.from(doc);
    const pos = ri(doc.length);
    doc[pos] = ri(256);
  }
  if (rnd() < 0.15) { doc = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf].slice(0, 1 + ri(3))), doc]); }
  if (rnd() < 0.2) { doc = doc.subarray(0, ri(doc.length) + 1); } // truncate
  // chunkings: whole, random 2-4 splits, byte-at-a-time for small docs
  check(`rand#${it} [whole]`, [doc]);
  const splits = [];
  const ns = 1 + ri(3);
  for (let s = 0; s < ns; s++) { splits.push(1 + ri(Math.max(1, doc.length - 1))); }
  splits.sort((x, y) => x - y);
  const chunks = [];
  let prev = 0;
  for (const s of splits) { if (s > prev && s < doc.length) { chunks.push(doc.subarray(prev, s)); prev = s; } }
  chunks.push(doc.subarray(prev));
  check(`rand#${it} [rsplit]`, chunks);
  if (doc.length <= 40) {
    const bytes = [];
    for (let i = 0; i < doc.length; i++) { bytes.push(doc.subarray(i, i + 1)); }
    check(`rand#${it} [bytes]`, bytes);
  }
}

console.log(`done: ${cases} cases, ${failures} mismatches`);
process.exit(failures ? 1 : 0);
