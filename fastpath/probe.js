'use strict';
const { runReal } = require('./real');

const probes = [
    // duplicate keys
    ['$.a', '{"a":1,"a":2}'],
    // nested descendant order
    ['$..a', '{"a":{"b":{"a":{"a":7}}}}'],
    ['$..a', '{"x":{"a":1},"a":{"y":{"a":2}}}'],
    // integer-like key emission order
    ['$', '{"b":1,"2":2,"10":3,"a":4}'],
    ['$..b', '{"10":{"b":1},"2":{"b":2},"a":{"b":3}}'],
    // matched array streams elements
    ['$.a', '{"a":[1,[2,3],{"x":4}]}'],
    ['$', '[1,[2],{"x":3}]'],
    ['$.a.b', '{"a":[[{"b":1}]]}'],
    ['$.a.b', '{"a":[{"b":[1,2]}]}'],
    // project on scalar / array / element
    ['$.a{x}', '{"a":5}'],
    ['$.a{x}', '{"a":[{"x":1},{"y":2},5]}'],
    ['$.a{x}', '{"a":{"x":1,"z":2}}'],
    // drop keys
    ['$.a<x>', '{"a":{"x":1,"z":{"x":9}}}'],
    ['$.a<x>', '{"a":[{"x":1,"y":2},3]}'],
    // drop-keys with nested overlapping matches
    ['$..a<x>', '{"a":{"x":1,"b":{"a":{"x":2,"y":3}}}}'],
    // project with nested overlapping matches
    ['$..a{y}', '{"a":{"y":1,"b":{"a":{"x":2,"y":3}}}}'],
    // wildcard
    ['$.*', '{"a":1,"b":[2,3],"c":{"d":4}}'],
    ['$.*', '[1,2]'],
    ['$.*.*', '{"a":{"b":{"c":1}},"d":[[5]]}'],
    ['$..*', '{"m":[[{"a":1}]]}'],
    // ancestor filters
    ['$..[!key1]child', '{"array":[{"key1":{"child":"v1"}},{"key2":{"child":"v2"}}]}'],
    ['$..[key1 || key2]child', '{"a":[{"key1":{"child":"v1"}},{"key3":{"child":"v3"}}]}'],
    ['$..[a]b', '{"a":{"c":{"b":1}},"x":{"b":2}}'],
    // filtered wildcard
    ['$..[a]*', '{"a":{"b":1},"c":{"d":2}}'],
    // scalar root
    ['$', '42'],
    ['$', '"hi"'],
    // NDJSON multiple docs
    ['$.a', '{"a":1}\n{"a":2}'],
    ['$.a', '{"a":1} {"a":2}'],
    // __proto__
    ['$.a', '{"a":{"__proto__":{"x":1}}}'],
    ['$.__proto__', '{"__proto__":5}'],
    // numbers
    ['$', '1e400'],
    ['$', '-0'],
    ['$', '9007199254740993'],
    ['$', '1.7976931348623157e308'],
    // empty containers
    ['$.a', '{"a":{}}'],
    ['$.a', '{"a":[]}'],
    // pathIncludeArrayIndex
    ['$.a..b', '{"a":[{"b":1},{"b":2}]}', { pathIncludeArrayIndex: true }],
    ['$', '[1,[2],{"x":3}]', { pathIncludeArrayIndex: true }],
    // project bare list = OR? and AND expr
    ['$.a{k1 k2}', '{"a":{"k1":1}}'],
    ['$.a{k1 && k2}', '{"a":{"k1":1}}'],
    // triple quotes
    ['$.q', '{"q":"""He said "hi""""}'],
    // errors and resync
    ['$.a', '{"a":1}\n{oops}\n{"a":3}'],
    ['$.a', '{"a":1}\n{"a":2,}\n{"a":3}'],
];

(async () => {
    for (const [sel, input, opts] of probes) {
        const r = await runReal(sel, input, opts);
        console.log(`== ${sel}  ${opts ? JSON.stringify(opts) : ''} << ${JSON.stringify(input)}`);
        console.log('   ' + JSON.stringify(r));
    }
})();
