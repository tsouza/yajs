# YAJS: **Y**et **A**nother **J**SON **S**treaming Tool

[![CI](https://github.com/tsouza/yajs/actions/workflows/ci.yml/badge.svg)](https://github.com/tsouza/yajs/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/yajson-stream.svg)](https://www.npmjs.com/package/yajson-stream)

YAJS filters JSON **as it streams**: point it at a file of any size — or an
endless NDJSON feed — give it a jsonpath-like selector, and get each matched
value the moment it goes by. The document is never loaded into memory; only
the current nesting depth and the values you actually matched are.

- **Constant memory** — kilobytes of state for multi-gigabyte inputs
- **jsonpath-like selectors** — wildcards, recursive descent (`..`),
  path filters, projection, key dropping
- **Library and CLI** — a Node stream you `pipe()` through, or a shell
  one-liner
- **NDJSON-native** — multiple documents per stream, with per-record error
  recovery (one bad line doesn't kill the rest)
- **TypeScript types** included (`YAJSChunk`, `YAJSOptions`)

## Motivation

The reason I built this tool is that I could not find a proper json stream
processor with the features I needed without sacrificing speed and memory.

There is a benchmark comparing YAJS with [oboe.js](https://github.com/jimhigson/oboe.js),
[JSONStream](https://github.com/dominictarr/JSONStream) and
[stream-json](https://www.npmjs.com/package/stream-json), including a fresh
2026 run — see [benchmark](benchmark.md).

## Install

```bash
$ npm install yajson-stream       # library
$ npm install -g yajson-stream    # command-line tool
```

> **Version note**: this README documents the current **2.x** code in this
> repository. The version published on npm at the time of writing is
> **1.3.3**, which predates a large round of fixes and behavior changes —
> for example, 1.3.3 enters an infinite error loop on a malformed NDJSON
> line, while 2.x reports the error and recovers at the next line. If you
> install from npm today you get the older behavior; install from this
> repository (or a published 2.x version, once available) to get what is
> described here.

## Example

Pipe a text stream of json into YAJS and select 'author' property:

```js
const yajs = require('yajson-stream');
const { createReadStream } = require('fs');

createReadStream('./package.json').
    pipe(yajs('$.author')).
    on('data', data => {
        console.log(data.path); // outputs [ 'author' ]
        console.log(data.value); // outputs 'Thiago Souza <tcostasouza@gmail.com>'
    });
```

Each `data` event is an object with two properties (exported to TypeScript
consumers as the `YAJSChunk` interface):

- `path`: array of object keys (and array indices, when
  `pathIncludeArrayIndex` is enabled — see [Options](#options)) leading from
  the document root to the match, e.g. `[ 'author' ]`.
- `value`: the matched value, fully materialized.

`yajs()` returns a classic *through* stream (typed as
`NodeJS.ReadWriteStream`): it supports `write()`/`end()`, `pipe()` in and
out, `pause()`/`resume()`, and the usual `'data'`/`'error'`/`'end'` events.
It is **not** an instance of `stream.Transform`, so don't rely on
Transform-specific API.

### Input handling

Both `Buffer` and plain-string writes are accepted: a string chunk is
converted to a `Buffer` as UTF-8 before parsing, so `stream.write('{"a":1}')`
and `stream.write(Buffer.from('{"a":1}'))` behave identically. This also
means `pipe()` works from both binary-mode and string-mode (`setEncoding`)
sources.

## Command line tool

Call it from a shell:

```bash
$ npm install -g yajson-stream
$ cat package.json | yajs '$.author'
"Thiago Souza <tcostasouza@gmail.com>"
```

The CLI reads JSON from stdin and prints each match as one JSON-encoded line
on stdout. It exits non-zero on parse errors (reported on stderr) and on an
invalid selector.

## YAJS Selector Syntax

YAJS selector syntax is jsonpath-like, yet it's **not** jsonpath.

YAJS Selector                     | Description
---------------------------------:|------------
`$`                               | The root object/element
`*`                               | Wildcard matching all objects/elements regardless
`.`                               | Child member operator
`..`                              | Recursive descendant operator
`..[<path filter>]<key>`          | Recursive descendant operator if path filter evaluates to true (see example below)
`<key>{<keys filter>}`            | Project: emit the matched object only if the keys filter evaluates to true. Only supported at the end of the expression (see example below)
`<key><k1 k2 ...>`                | Drop keys: emit the matched object *without* the listed top-level keys. Only supported at the end of the expression (see example below)

Filter expressions (inside `[...]` and `{...}`) support the boolean
operators `&&`, `||`, `!` and parentheses `(...)`. A bare list of
space-separated keys is also accepted; in `{...}` it means "all of these
keys present" and in `<...>` it lists the keys to drop.

`{...}` and `<...>` are mutually exclusive — a selector may end in one or
the other, not both. Combining them is rejected up front with a clear error:

```bash
$ echo '{}' | yajs '$.a{key1}<key2>'
Invalid selector "$.a{key1}<key2>": A selector can't combine project ({...}) and drop-keys (<...>) - they are mutually exclusive; use only one of them.
```

### Wildcard `*`

Matches every child, whatever its key:

```bash
$ echo '{"a":{"x":1,"y":"two"}}' | yajs '$.a.*'
1
"two"
```

### Path filters: `..[<filter>]<key>`

A path filter gates the recursive descent to `<key>` on the **key names
traversed along the descent path** (the ancestor keys between where the
filter applies and the match). It is a test for key presence on that path —
not a general-purpose predicate over values or sibling keys.

Given the following json (`test.json`):

```js
{
    "array": [
        {
            "key1": {
                "child": "value1"
            }
        },
        {
            "key2": {
                "child": "value2"
            }
        }
    ]
}
```

Select only the second `child` entry with:

```bash
$ cat test.json | yajs '$..[!key1]child'
"value2"
```

The first `child` is skipped because its descent path (`array` → `key1` →
`child`) passes through a key named `key1`; the second one's path does not.
Note that a `key1` merely *next to* the match (a sibling that the descent
never passes through) does not satisfy the filter.

Boolean operators work here too:

```bash
$ echo '{"a":[{"key1":{"child":"v1"}},{"key3":{"child":"v3"}}]}' | yajs '$..[key1 || key2]child'
"v1"
```

### Self-nesting descendant matches: innermost by default

`$..a` finds `a` at any depth. When a document's `a` nests **inside
another `a`** — comment threads, category trees, folder structures — only
the **innermost** occurrence is emitted by default:

```bash
$ echo '{"a":{"b":{"a":{"c":1}}}}' | yajs '$..a'
{"c":1}
```

The outer `a` (`{"b":{"a":{"c":1}}}`) is not emitted. This is a deliberate
default, not a filter you opt into — `$..a` still parses exactly as
before, only its *output* for a self-nesting document changed. Two `a`
matches that are **not** nested in each other (disjoint branches, or
siblings in an array) are completely unaffected and are both still
emitted:

```bash
$ echo '{"p":{"a":{"a":1}},"q":{"a":2}}' | yajs '$..a'
1
2
```

For any document where the matched key never actually nests inside itself
— the overwhelming majority of real-world `..` usage — this default is a
complete no-op: identical output to matching `$..a` has always produced.

> **Behavior change (2.x)**: versions of this repository before this
> change emitted **both** the outer and the inner occurrence for a
> self-nesting `$..a` match (issue #38's "matches inside matches"
> handling). If your selector's target key can nest inside itself and you
> relied on seeing every overlapping occurrence, that output has changed —
> see [ARCHITECTURE.md §4](ARCHITECTURE.md#4-the-recorder--libdispatcher-and-libcontextstreamcontextts)
> for the mechanism and [CHANGELOG.md](CHANGELOG.md) for this entry. There
> is currently no selector syntax to opt back into the old "emit every
> overlapping match" behavior for a named-key descendant selector — an
> explicit `outermost` opt-in was considered and deliberately descoped
> (see issue #89).
>
> This does **not** apply to a wildcard-terminated descendant selector
> (`$..*`, `$.*.*`, …) — those keep matching at every level, exactly as
> before; only a descendant selector ending in a plain key (`$..a`,
> `$.x..a`, `$..[f]a`, …) defaults to innermost-only.
>
> The opt-in NDJSON fast path (`fastPath: true`, below) does not implement
> this: it still emits every overlapping match for a self-nesting document,
> a known, documented divergence from the default engine's behavior.

### Project: `<key>{<keys filter>}`

Emits the matched object only if the filter over its **top-level keys**
evaluates to true.

Given the following json (`test.json`):

```js
[
    {
        "object1": {
            "key1": "value1"
        }
    },
    {
        "object1": {
            "key2": "value1"
        }
    }
]
```

Will emit only the first `object1`:

```bash
$ cat test.json | yajs '$.object1{key1}'
{"key1":"value1"}
```

Boolean operators and parentheses (shown here on NDJSON input, one document
per line):

```bash
$ printf '{"a":{"key1":1,"key2":2}}\n{"a":{"key1":1}}\n' | yajs '$.a{key1 && key2}'
{"key1":1,"key2":2}

$ printf '{"a":{"key1":1}}\n{"a":{"key2":2}}\n{"a":{"key3":3}}\n' | yajs '$.a{key1 || key2}'
{"key1":1}
{"key2":2}

$ printf '{"a":{"key1":1}}\n{"a":{"key2":2}}\n' | yajs '$.a{!key1}'
{"key2":2}

$ printf '{"a":{"key1":1,"key2":2}}\n{"a":{"key1":1}}\n' | yajs '$.a{!(key1 && key2)}'
{"key1":1}
```

### Drop keys: `<key><k1 k2 ...>`

Emits the matched object with the listed **top-level** keys removed.
Nested occurrences of the same key names are kept — only the emitted
object's own entries are dropped:

```bash
$ echo '{"a":{"key1":1,"key2":2,"key3":3}}' | yajs '$.a<key1 key3>'
{"key2":2}
```

## Options

`yajs(path, options)` accepts an options object as its second argument
(exported to TypeScript consumers as the `YAJSOptions` interface):

Option                    | Type    | Default | Description
--------------------------|---------|---------|------------
`pathIncludeArrayIndex`   | boolean | `false` | Include array indices (as numbers) in each emitted chunk's `path`
`fastPath`                | boolean | `false` | Opt-in NDJSON fast path — see [NDJSON fast path](#ndjson-fast-path-opt-in) below
`fastPathMaxRecordBytes`  | number  | `8388608` (8 MiB) | Per-record size cutoff for `fastPath` — see below

```js
const yajs = require('yajson-stream');

const stream = yajs('$.a..b', { pathIncludeArrayIndex: true });
stream.on('data', data => console.log(data.path, data.value));
stream.write('{"a":[{"b":1},{"b":2}]}');
stream.end();
// outputs:
//   [ 'a', 0, 'b' ] 1
//   [ 'a', 1, 'b' ] 2
// (without the option, both paths would be [ 'a', 'b' ])
```

## NDJSON fast path (opt-in)

For NDJSON-shaped input (one JSON value per line — YAJS's primary use case),
`{ fastPath: true }` bypasses the byte-by-byte SAX tokenizer: each line is
handed to native `JSON.parse`, then walked directly against your selector,
instead of being tokenized one character at a time. Measured **~5x**
end-to-end throughput improvement for the common case of a definite key-chain
selector (e.g. `$.field2.nested`) against NDJSON input — see
[issue #78](https://github.com/tsouza/yajs/issues/78) for the full
investigation and measured numbers.

```js
const stream = yajs('$.field2.nested', { fastPath: true });
```

It is **off by default** and **not auto-detected** — enable it only for input
you know is NDJSON-shaped (whitespace/newline-separated top-level JSON
values). This is a newer, less battle-tested code path than the default
engine, so it stays fully opt-in rather than replacing the default.

**It never sacrifices correctness for speed.** Anything one `JSON.parse` call
per line can't handle on its own — a malformed line, a record pretty-printed
across multiple physical lines, the `"""` triple-quote extension, multiple
values on one line, or a record larger than `fastPathMaxRecordBytes` (default
8 MiB, to bound memory on an oversized record) — falls back to the exact same
streaming engine `fastPath: false` uses, including issue #50's per-record
error-and-resync behavior. Only that one record pays the slower cost; the
fast path resumes normally for the records after it.

### Three accepted differences from the default engine

Only matter if your data can actually contain them:

1. **Duplicate object keys.** The default engine emits one match per
   occurrence of a duplicated key; `fastPath` (via `JSON.parse`) keeps only
   the last occurrence. Inherent to using `JSON.parse` under the hood.
2. **Integer-like key emission order.** `JSON.parse`'s objects always
   enumerate integer-like keys first, in ascending order, ahead of string
   keys — regardless of their order in the source text (this is standard
   JavaScript object key semantics, not a YAJS quirk). When an object's raw
   text key order differs from that enumeration order, `fastPath` emits that
   object's sibling matches in the *enumeration* order instead of the raw
   text order. Values and paths are unaffected — only the order matches
   arrive in can differ. Also inherent to using `JSON.parse`.
3. **Self-nesting descendant matches (issue #89).** The default engine's
   `$..a`-shaped selectors are innermost-only for a self-nesting document
   (see "Self-nesting descendant matches" above); `fastPath`'s walker has no
   notion of "this match was superseded by a deeper one" and still emits
   every overlapping match, the *pre-#89* behavior. Unlike the two above,
   this isn't inherent to `JSON.parse` — it's a known scoping gap in
   `fastPath`'s own matcher, tracked separately rather than fixed as part of
   #89.

### What's deferred

Per issue #78's own recommended build order, this ships only the
"line/chain fast path" — the array splitter (treating a top-level/nested JSON
array as comma-delimited "NDJSON") and the full span-parsing hybrid engine
(which also solves the "one huge record in an otherwise-small-record stream"
memory case more directly) are deferred to future work — see the issue for
details.

## Non-standard extensions

YAJS deliberately accepts two inputs that are not standard JSON. If you are
using it to *validate* strict JSON, be aware that these are accepted rather
than rejected.

### Multiple top-level documents (NDJSON)

A single stream may contain multiple whitespace-separated top-level JSON
values — NDJSON-style one-per-line input, or even space-separated values on
one line. Each top-level value (or each match beneath it, per the selector)
is reported as its own `data` event.

### Triple-quoted strings

A string value may be written with triple quotes, `"""..."""`, in which case
unescaped `"` characters are allowed inside it:

```bash
$ printf '{"quote":"""He said "hi" to me"""}\n' | yajs '$.quote'
"He said \"hi\" to me"
```

## NDJSON error handling

A malformed line in NDJSON-style input reports an `error` event with that
line's own parse error.

Parsing resumes with the next line after a malformed one: yajs resyncs at the
next newline, so one bad record does not take down every valid record that
follows it in the same stream. Only that one record is lost - everything
before and after it is still reported normally. (This is a per-record
recovery inside the parser itself, distinct from Node's own `pipe()`
behavior: once a stream emits `error`, `Readable#pipe()` unpipes its source
to protect the destination, so a single-shot pipe like
`process.stdin.pipe(yajs(...))` only benefits from this recovery for data
already delivered to yajs in the same chunk/tick as the error - later chunks
require re-piping, or driving the stream directly via `write()`/`parse()`
instead of `pipe()`.)

```bash
$ printf '{"a":1}\n{oops}\n{"a":3}\n' | yajs '$.a'
1
3
# stderr: Error: Unexpected "o" at position 9 in state START   (exit status 1)
```

## How it works

In one sentence: YAJS watches the JSON go by as a stream of parser events,
keeps a breadcrumb-trail stack of "where am I right now," checks that trail
against your compiled selector at each step, and switches on a small recorder
only while a matched value is passing by — so memory stays proportional to
nesting depth plus matched values, never to input size.

The full walkthrough — the tokenizer, the position stack, how wildcard and
`..` matching really work (including why they need backtracking), the
recorder and nested-match suspension, and where the CPU time goes — is in
**[ARCHITECTURE.md](ARCHITECTURE.md)**. The algorithm is a TypeScript port of
[JsonSurfer](https://github.com/jsurfer/JsonSurfer) (Java).

## Development

`npm test` runs the full suite (`vitest run`); `npm run lint` runs ESLint.

Mutation testing ([Stryker](https://stryker-mutator.io/)) is available as a
manual, opt-in check of the test suite itself — scoped to `src/main/lib/path/`
and `src/main/lib/context/`, the two directories with the deepest and
most bug-prone matching/streaming logic per this project's own issue
history. It is deliberately **not** wired into CI: a full run takes 15+
minutes. To run it locally:

```sh
npx stryker run
```

This uses `stryker.conf.json` and `vitest.stryker.config.ts` (a mutation-run-only
Vitest config that additionally excludes `src/test/06-conformance.ts` — see
that file's own comment for why). Results are written to
`reports/mutation/mutation.html` (gitignored, along with Stryker's
`.stryker-tmp/` scratch directory).

## Documentation

This README is the primary reference for using YAJS;
[ARCHITECTURE.md](ARCHITECTURE.md) documents how it works inside. (The
project's GitHub wiki predates the 2.x rewrite by many years and is kept only
as a historical artifact — prefer these documents.)

## Bugs and Feedback

For bugs, questions and discussions please use the [Github Issues](https://github.com/tsouza/yajs/issues).

## Acknowledgements

* Thanks to [wanglingsong](https://github.com/wanglingsong) for his awesome work with [JsonSurfer](https://github.com/jsurfer/JsonSurfer) which inspired me to create YAJS.
* Thanks to [creationix](https://github.com/creationix) for his crazy fast [sax-based json parser](https://gist.github.com/creationix/1821394).
* Thanks to [Nicolas Seriot](https://github.com/nst) for [JSONTestSuite](https://github.com/nst/JSONTestSuite), used as this project's JSON conformance test corpus.

## LICENSE

Code and documentation released under [The MIT License (MIT)](LICENSE).
