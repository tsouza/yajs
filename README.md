# YAJS: **Y**et **A**nother **J**SON **S**treaming Tool

[![CI](https://github.com/tsouza/yajs/actions/workflows/ci.yml/badge.svg)](https://github.com/tsouza/yajs/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/yajson-stream.svg)](https://www.npmjs.com/package/yajson-stream)

YAJS is a tool for filtering a portion of json files.

## Motivation

The reason I built this tool is that I could not find a proper json stream processor with the features I needed without sacrificing speed and memory.

There is also a benchmark of this tool comparing it with [oboe.js](https://github.com/jimhigson/oboe.js), [JSONStream](https://github.com/dominictarr/JSONStream) and [stream-json](https://www.npmjs.com/package/stream-json). See [benchmark](benchmark.md).

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

Option                  | Type    | Default | Description
------------------------|---------|---------|------------
`pathIncludeArrayIndex` | boolean | `false` | Include array indices (as numbers) in each emitted chunk's `path`

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

## Documentation

This README is the primary reference for YAJS. (The project's GitHub wiki
predates the 2.x rewrite by many years and is kept only as a historical
artifact — prefer this document.)

## Bugs and Feedback

For bugs, questions and discussions please use the [Github Issues](https://github.com/tsouza/yajs/issues).

## Acknowledgements

* Thanks to [wanglingsong](https://github.com/wanglingsong) for his awesome work with [JsonSurfer](https://github.com/jsurfer/JsonSurfer) which inspired me to create YAJS.
* Thanks to [creationix](https://github.com/creationix) for his crazy fast [sax-based json parser](https://gist.github.com/creationix/1821394).
* Thanks to [Nicolas Seriot](https://github.com/nst) for [JSONTestSuite](https://github.com/nst/JSONTestSuite), used as this project's JSON conformance test corpus.

## LICENSE

Code and documentation released under [The MIT License (MIT)](LICENSE).
