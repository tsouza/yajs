# Changelog

## 2.0.0-beta.1 (unreleased)

First release cut in several years. Two things happened in this cycle: the
project was modernized end-to-end, and roughly thirty long-standing bugs
were found and fixed. Issue/PR links: [issues](https://github.com/tsouza/yajs/issues),
[pull requests](https://github.com/tsouza/yajs/pulls).

### Behavior changes

- **`$..a`-shaped descendant matches are innermost-only for a self-nesting
  document.** When the matched key nests inside itself (`$..a` where an
  `a` contains another `a` — comment threads, category trees, folder
  structures), the engine used to emit **both** the outer and the inner
  occurrence (issue #38's overlap handling). It now emits only the
  **innermost** occurrence by default. No selector syntax changed — bare
  `$..a` still parses exactly as before, only its *output* for a
  self-nesting document is different. Two matches that are **not** nested
  in each other (disjoint branches, array siblings) are completely
  unaffected. A wildcard-terminated descendant selector (`$..*`, `$.*.*`)
  is unaffected too — it still matches every level, exactly as before. See
  the README's "Self-nesting descendant matches" section and
  [ARCHITECTURE.md §4](ARCHITECTURE.md#4-the-recorder--libdispatcher-and-libcontextstreamcontextts)
  for the mechanism (discard-and-replace, replacing the old park+inject
  recorder stack), and note the opt-in `fastPath` walker does **not**
  implement this yet — it still emits every overlapping match, a known,
  separately-tracked divergence — [#89](https://github.com/tsouza/yajs/issues/89), [PR #94](https://github.com/tsouza/yajs/pull/94)

### New features

- **Regex filter primitive** (`{/pattern/}` / `[/pattern/]`), generalizing the existing bare-key-presence
  filter primitive from "is this exact key present" to "is there a key matching this pattern present" — an
  existential match against the same key set the bare-key primitive already tests (the matched object's own
  top-level keys for project `{...}`, the ancestor keys traversed along the descent path for a path filter
  `..[<filter>]<key>`). Composes with the existing boolean grammar (`&&`, `||`, `!`, parens, bare keys)
  exactly like any other primitive. **Project (`{...}`) and drop-keys (`<...>`) can now be combined** — in
  the `{...}<...>` written order only — but ONLY when at least one side uses this new regex primitive; a
  pure-literal combination (`{key1}<key2>`, no regex anywhere) stays rejected exactly as before. When
  combined, the project gate evaluates first, against the object's full, undropped top-level keys, and
  drop-keys is applied second — so a regex-based gate matching on a key that drop-keys then removes is not a
  contradiction. See the README's "Regex filter primitive" and "Drop keys" sections for worked examples —
  [#95](https://github.com/tsouza/yajs/issues/95), [#96](https://github.com/tsouza/yajs/issues/96), [PR #98](https://github.com/tsouza/yajs/pull/98)

### Modernization

- TypeScript 5.9, vitest, ESLint 9, GitHub Actions CI, real test coverage (including the [JSONTestSuite](https://github.com/nst/JSONTestSuite) conformance corpus) — [PR #7](https://github.com/tsouza/yajs/pull/7)
- Benchmark suite restored to working order on [tsx](https://github.com/privatenumber/tsx); [stream-json](https://www.npmjs.com/package/stream-json) added as a fourth comparison — [PR #30](https://github.com/tsouza/yajs/pull/30)
- Node.js >= 22 required (CI runs 22.x and 24.x)

### Matching engine correctness

- Wildcard `$.*` never matched array elements, only object properties — [#20](https://github.com/tsouza/yajs/issues/20), [PR #22](https://github.com/tsouza/yajs/pull/22)
- Descendant scan (`..`) preceded by a named key or wildcard mismatched through arrays (false negatives and positives) — [#27](https://github.com/tsouza/yajs/issues/27), [PR #33](https://github.com/tsouza/yajs/pull/33)
- Wildcard reaching an array of objects spuriously matched nested field values, corrupting the real match — [#28](https://github.com/tsouza/yajs/issues/28), [PR #33](https://github.com/tsouza/yajs/pull/33)
- Drop-keys `<...>` silently ignored `&&`/`||`/`!` instead of handling them — [#29](https://github.com/tsouza/yajs/issues/29), [PR #33](https://github.com/tsouza/yajs/pull/33)
- Filter `[expr]key` silently dropped the key-name check, matching every sibling key — [#37](https://github.com/tsouza/yajs/issues/37), [PR #41](https://github.com/tsouza/yajs/pull/41)
- A nested match corrupted (or dropped) its ancestor's own captured value when both matched — [#38](https://github.com/tsouza/yajs/issues/38), [PR #43](https://github.com/tsouza/yajs/pull/43)
- `$.*..*` under-matched beyond one hop past the descendant — [#39](https://github.com/tsouza/yajs/issues/39), [PR #43](https://github.com/tsouza/yajs/pull/43)
- `$.a..x` missed matches when key `a` repeats at multiple ancestor depths (no backtracking) — [#45](https://github.com/tsouza/yajs/issues/45), [PR #48](https://github.com/tsouza/yajs/pull/48)
- Project `{...}` silently dropped the match entirely when the matched value was a scalar — [#46](https://github.com/tsouza/yajs/issues/46), [PR #48](https://github.com/tsouza/yajs/pull/48)
- Nested arrays were recursively flattened to scalars instead of streaming one level at a time — [#14](https://github.com/tsouza/yajs/issues/14), [PR #21](https://github.com/tsouza/yajs/pull/21)
- A matched array was never dispatched as a single value (unlike objects) — [#15](https://github.com/tsouza/yajs/issues/15), [PR #21](https://github.com/tsouza/yajs/pull/21)
- Keys named `__proto__` (or matching an `Object.prototype` method) were silently dropped, and could not be targeted by selectors — [#12](https://github.com/tsouza/yajs/issues/12), [#13](https://github.com/tsouza/yajs/issues/13)
- `pathIncludeArrayIndex` reported off-by-one indices for sibling arrays sharing a stack depth — [#60](https://github.com/tsouza/yajs/issues/60), [PR #63](https://github.com/tsouza/yajs/pull/63)

### Parser & NDJSON robustness

- Infinite error loop on malformed input — [#5](https://github.com/tsouza/yajs/issues/5), [PR #7](https://github.com/tsouza/yajs/pull/7)
- NDJSON: one malformed document permanently and silently dropped all subsequent valid documents; the parser now reports the error and resyncs at the next newline — [#50](https://github.com/tsouza/yajs/issues/50), [PR #55](https://github.com/tsouza/yajs/pull/55)
- A bare top-level NDJSON string was lost when immediately followed by a record that errors — [#56](https://github.com/tsouza/yajs/issues/56), [PR #58](https://github.com/tsouza/yajs/pull/58)
- A bare empty-string (`""`) document failed to parse at end-of-stream — [#62](https://github.com/tsouza/yajs/issues/62), [PR #65](https://github.com/tsouza/yajs/pull/65)
- A leading UTF-8 BOM was rejected as a parse error instead of being stripped — [#51](https://github.com/tsouza/yajs/issues/51), [PR #53](https://github.com/tsouza/yajs/pull/53)
- Missing commas, colons, leading zeros and unclosed structures were silently accepted (no structural validation between tokens) — [#11](https://github.com/tsouza/yajs/issues/11)
- Raw multi-byte UTF-8 in strings was corrupted into mojibake — [#10](https://github.com/tsouza/yajs/issues/10)
- Silent hang (zero signal) on an unmatched closing bracket — [#9](https://github.com/tsouza/yajs/issues/9)
- OOM crash on deeply nested arrays at the root — [#8](https://github.com/tsouza/yajs/issues/8)

### Numeric precision

- Large/extreme JSON numbers were silently parsed to the wrong value — [#49](https://github.com/tsouza/yajs/issues/49), [PR #54](https://github.com/tsouza/yajs/pull/54)

### Backpressure & streaming

- Stream backpressure was bypassed: matches were emitted synchronously regardless of downstream readiness — [#36](https://github.com/tsouza/yajs/issues/36), [PR #40](https://github.com/tsouza/yajs/pull/40)
- Plain-string writes are now accepted (converted to UTF-8 Buffers) instead of failing with a misleading NUL-byte error — [#61](https://github.com/tsouza/yajs/issues/61), [PR #64](https://github.com/tsouza/yajs/pull/64)

### Error UX

- The CLI exited with status 0 even when parsing failed — [#16](https://github.com/tsouza/yajs/issues/16), [PR #21](https://github.com/tsouza/yajs/pull/21)
- The CLI crashed with a raw internal stack trace on an invalid selector — [#23](https://github.com/tsouza/yajs/issues/23), [PR #24](https://github.com/tsouza/yajs/pull/24)
- Malformed selector strings either silently matched everything or crashed the process — [#18](https://github.com/tsouza/yajs/issues/18), [PR #21](https://github.com/tsouza/yajs/pull/21)
- The selector grammar did not require EOF, so trailing garbage after a valid prefix was silently ignored — [#19](https://github.com/tsouza/yajs/issues/19), [PR #25](https://github.com/tsouza/yajs/pull/25)
- Combining project `{...}` and drop-keys `<...>` now fails with a clear "mutually exclusive" error instead of a raw ANTLR message — [#52](https://github.com/tsouza/yajs/issues/52), [PR #53](https://github.com/tsouza/yajs/pull/53)
- Filter/project keys were interpolated unescaped into generated code, crashing on a literal apostrophe — [#17](https://github.com/tsouza/yajs/issues/17), [PR #21](https://github.com/tsouza/yajs/pull/21)
- Stack overflow (uncaught RangeError) on deeply nested filter-expression parentheses — [#35](https://github.com/tsouza/yajs/issues/35), [PR #42](https://github.com/tsouza/yajs/pull/42)
- `buildArgsExpression()`/`extractKeys()` generated invalid JS (or dropped keys) for parenthesized groups, bare-key lists and leading operators — [#26](https://github.com/tsouza/yajs/issues/26), [PR #32](https://github.com/tsouza/yajs/pull/32)

### Performance

- O(depth²) time blowup in descendant (`..`) matching against deeply nested documents — [#34](https://github.com/tsouza/yajs/issues/34), [PR #43](https://github.com/tsouza/yajs/pull/43)
- Reduced per-match path-materialization cost (O(depth) per match, compounding across matches) — [#44](https://github.com/tsouza/yajs/issues/44), [PR #47](https://github.com/tsouza/yajs/pull/47)
- Matching layer: dispatcher pooling, `StreamPosition` reuse across NDJSON records, and closure removal on the hot event-dispatch path — [#76](https://github.com/tsouza/yajs/issues/76), [PR #81](https://github.com/tsouza/yajs/pull/81)
- Tokenizer: batch runs of plain-ASCII string content and consecutive number digits into a single materialization call instead of one append per byte (non-ASCII content is unaffected, still routed through the existing incremental UTF-8 decoder) — [#77](https://github.com/tsouza/yajs/issues/77), [PR #82](https://github.com/tsouza/yajs/pull/82)
- New opt-in `fastPath` option: a `JSON.parse`-based fast path for NDJSON input, ~5x faster for the common definite-key-chain selector shape — [#78](https://github.com/tsouza/yajs/issues/78), [PR #88](https://github.com/tsouza/yajs/pull/88)
- `fastPath`'s new `fastPathMode: 'array'` (default remains `'ndjson'`): the array-splitter fast path, generalizing the same idea to a top-level JSON array's comma-delimited elements instead of newline-delimited records — [#86](https://github.com/tsouza/yajs/issues/86), [PR #97](https://github.com/tsouza/yajs/pull/97)
- New `fastPath: 'hybrid'` mode: a SKIP/PARSE/DESCEND span-parsing evaluator for `$..k1.k2...kn`-shaped descendant selectors — navigates a record's raw bytes directly to matched values instead of materializing the whole record. Real win tracks selectivity: ~3.2x on a high-selectivity real-data descendant selector (dataset 2's own `$..plugins`), ~5.1x on a synthetic high-selectivity "whale record" (one huge top-level object, most content irrelevant) built to isolate that case, but ~no win on a selector that matches nearly everything (dataset 4's own `$..array.deep1`, which turns out to be low-selectivity for that dataset's actual content) — freshly measured, not the throwaway go/no-go spike's own best-case number restated (see README's own Performance section and benchmark.md for the honest per-shape breakdown). Unlike `'line'`/`fastPathMaxRecordBytes`, never needs to buffer a whole record — only actual matched spans — so a huge, low-content-density "whale record" still gets the speedup as long as its individual matches stay reasonably sized (`hybridMaxSpanBytes`). Implements issue #89's innermost-only self-nesting default natively (unlike `'line'` mode's own documented divergence there). See the README's "SKIP/PARSE/DESCEND span-parsing hybrid fast path" section — [#79](https://github.com/tsouza/yajs/issues/79), [#87](https://github.com/tsouza/yajs/issues/87), [PR #99](https://github.com/tsouza/yajs/pull/99)

### Packaging & types

- `yajs()`'s declared return type is now the honest `NodeJS.ReadWriteStream` (the returned object is a classic `through` stream, not a `stream.Transform`); the emitted chunk shape is exported as the `YAJSChunk` interface and the options object as `YAJSOptions`
- Removed the misleading `module` field (it pointed at a CommonJS file); added `engines` (Node >= 22); the npm tarball now ships only `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`

## 1.3.3 and earlier

See the [git history](https://github.com/tsouza/yajs/commits/master) and
[releases](https://github.com/tsouza/yajs/tags).
