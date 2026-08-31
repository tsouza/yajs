# YAJS: **Y**et **A**nother **J**SON **S**treaming Tool

[![Build Status via Travis CI](https://travis-ci.org/tsouza/yajs.svg?branch=master)](https://travis-ci.org/tsouza/yajs)
[![NPM version](https://img.shields.io/npm/v/yajson-stream.svg)](https://www.npmjs.com/package/yajson-stream)
[![Dependency Status via David DM](https://david-dm.org/tsouza/yajs/status.svg)](https://david-dm.org/tsouza/yajs)

YAJS is a tool for filtering a portion of json files.

## Motivation

The reason I built this tool is that I could not find a proper json stream processor with the features I needed without sacrificing speed and memory.

There is a also a benchmark of this tool comparing with [oboe.js](https://github.com/jimhigson/oboe.js) and [JSONStream](https://github.com/dominictarr/JSONStream). See [benchmark](benchmark.md).

## Documentation

Head over to [Wiki](https://github.com/tsouza/yajs/wiki/Getting-Started) for more information on how to use it.

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

## Command line tool

Call it from a shell:

```bash
$ npm install -g yajson-stream
$ cat package.json | yajs '$.author'
"Thiago Souza <tcostasouza@gmail.com>"
```

## NDJSON and error handling

YAJS also accepts NDJSON-style input: multiple top-level JSON values, one per
line, in a single stream. Each `data` event carries one fully-parsed
top-level value (or a match beneath it, per the selector), and a malformed
line reports an `error` event with that line's own parse error.

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

## YAJS Selector Syntax

YAJS selector syntax is jsonpath-like, yet it's **not** jsonpath.

YAJS Selector                     | Description
---------------------------------:|------------
`$`                               | The root object/element
`*`                               | Wildcard matching all objects/elements regardless
`.`                               | Child member operator
`..`                              | Recursive descendant operator
`..[<path filter>]<key>`          | Recursive descendant operator if path filter evaluates to true (see example below)
`<key>{keys filter}`              | Will emit only if keys filter evaluates to true. Only supported in the end of the expression (see example below)

### Example of `..[<filter keys>]<key>`

Given the following json:

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

### Example of `<key>{<keys filter>}`

Given the following json:

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

## Bugs and Feedback

For bugs, questions and discussions please use the [Github Issues](https://github.com/tsouza/yajs/issues).

## Acknowledgements

* Thanks to [wanglingsong](https://github.com/wanglingsong) for his awesome work with [JsonSurfer](https://github.com/jsurfer/JsonSurfer) which inspired me to create YAJS.
* Thanks to [creationix](https://github.com/creationix) for his crazy fast [sax-based json parser](https://gist.github.com/creationix/1821394).
* Thanks to [Nicolas Seriot](https://github.com/nst) for [JSONTestSuite](https://github.com/nst/JSONTestSuite), used as this project's JSON conformance test corpus.

## LICENSE

Code and documentation released under [The MIT License (MIT)](LICENSE).
