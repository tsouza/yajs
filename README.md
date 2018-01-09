# YAJS: **Y**et **A**nother **J**SON **S**treaming Tool

<a href="https://travis-ci.org/tsouza/yajs/builds"><img src="https://travis-ci.org/tsouza/yajs.svg?branch=master"></a>

YAJS is a tool for filtering a portion of json files.

## Example

Pipe a text stream of json into YAJS and select 'author' property:

```js
const yajs = require('yajson-stream');
const { createReadStream } = require('fs');

createReadStream('./package.json').
    pipe(yajs('$.author')).
    on('data', data => {
        console.log(data.path); // outputs [ 'author' ]
        console.log(data.value); // outputs 'Thiago Souza <thiago@elastic.co>'
    });
```

## Command line tool

Call it from a shell:

```bash
$ npm install -g yajson-stream
$ cat package.json | yajs '$.author'
"Thiago Souza <thiago@elastic.co>"
```

## YAJS Selector Syntax

YAJS selector syntax is jsonpath-like, yet it's **not** jsonpath.

YAJS Selector              | Description
---------------------------|------------
`$`                        | The root object/element
`*`                        | Wildcard matching all objects/elements regardless
`.`                        | Child member operator
`..`                       | Recursive descendant operator
`..[<path filter>]<key>`   | Recursive descendant operator if path filter evaluates to true (see example below)
`<key>{keys filter>}`      | Will emit only if keys filter evaluates to true. Only supported in the end of the expression (see example below)

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

### Example of `<key>{<projection keys>}`

Given the following json:

```js
{
    "object1": {
        "key1": "value1",
        "key2": "value2",
        "key3": "value2"
    }
}
```

Pick only the `key1` field with:

```bash
$ cat test.json | yajs '$.object1{key1 key3}'
{"key1":"value1","key3":"value2"}
```

## Bugs and Feedback

For bugs, questions and discussions please use the [Github Issues](issues).

## Acknowledgements

Thanks to [wanglingsong](https://github.com/wanglingsong) for his awesome work with [JsonSurfer](https://github.com/jsurfer/JsonSurfer) which inspired me to create YAJS.

## LICENSE

Code and documentation released under [The MIT License (MIT)](LICENSE).
