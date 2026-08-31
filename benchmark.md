# Benchmark

This is a benchmark comparing yajs with other json streaming js libraries:
[oboe.js](https://github.com/jimhigson/oboe.js) and
[JSONStream](https://github.com/dominictarr/JSONStream), with
[stream-json](https://www.npmjs.com/package/stream-json) available as a
fourth comparison in the current harness (see the update note below).

Most of the numbers in the [Results](#results) section are the **historical
April 2018 run** of yajs 1.3.0, executed under the software/hardware
configuration listed below and not re-run since. The exception is Dataset 1,
which also has a fresh 2026 run against all four libraries - see
[Dataset 1 (2026)](#dataset-1-2026).

*Update (2026)*: the bench suite's toolchain (which had bit-rotted after
`ts-node` was removed) was restored to working order, running the
hand-written `bench-*.ts` scripts directly via [tsx](https://github.com/privatenumber/tsx)
(see `package.json`). While restoring it, stream-json
was added as a fourth *available* comparison alongside the original
oboe.js/JSONStream pair: oboe.js has seen no meaningful release since ~2016
and JSONStream is maintained but old-style, while stream-json is the
actively-maintained, widely-used modern standard for this class of tool
today. A fresh Dataset 1 run with all four libraries (2026 environment) is
included below as [Dataset 1 (2026)](#dataset-1-2026); Datasets 2-4 remain
the original 2018 numbers only, since their source files are multi-gigabyte
and re-running them is impractical to do routinely. To get current numbers
for all four on your own machine, run `npm run bench`.

## Method

For each library, a sequence of different datasets was used to process with equivalent selection path. It was measured the total time of execution and also the rate of the objects produced per second (EPS) using [measured](https://github.com/felixge/node-measured).

See [bench](src/bench) for more details

*NOTE: Due to the large size of the datasets, they are gzipped on disk and are gunzipped on the fly before feeding the library.*

## Datasets

Dataset | Format | Size  | Object size | Objects | Root Type
:------:|--------|-------|-------------|---------|----------
1       | ndjson | 76MB  | 80B         | 1M      | object
2       | ndjson | 10GB  | 5.3KB       | 2M      | object
3       | json   | 15GB  | 5.3KB       | 3M      | array
4       | json   | 5.2GB | 5.2GB       | 1       | object

### Selection paths

Dataset/Library   | yajs              | JSONStream             | oboe.js                     | stream-json
:----------------:|-------------------|------------------------|------------------------------|------------------------
1                 | `$.field2.nested` | `field2.nested.*`      | `!.field2.nested[*]`        | `(^\|\.)nested\.\d+$`
2                 | `$..plugins`      | `_source..plugins.*`   | `!._source..plugins[*]`     | `(^\|\.)plugins\.\d+$`
3                 | `$..plugins`      | `*._source..plugins.*` | `![*]._source..plugins[*]`  | `(^\|\.)plugins\.\d+$`
4                 | `$..array.deep1`  | `*..array.*.deep1`     | `!..array[*].deep1`         | `(^\|\.)array\.\d+\.deep1$`

*NOTE: stream-json has no dot-path selector DSL of its own - its `pick()`
filter matches a `RegExp` (or string/function) against the joined stack of
keys/array-indices a token is nested under. The expressions above are that
`RegExp`'s source, written to match on the tail of the path so they fire
once per matched element regardless of nesting depth, mirroring the other
three libraries' recursive (`..`) selectors. See `bench-stream-json.ts`.*

## Software Configuration

*(As of the historical April 2018 run reported in Results below.)*

Software    | Version
------------|-----------------------------------------
OS          | Ubuntu 17.10 (kernel 4.13.0-38-generic)
Node.js     | 9.11.1
ts-node     | 5.0.1
typescript  | 2.7.2
yajs        | 1.3.0
JSONStream  | 1.3.2
oboe.js     | 2.1.4

## Hardware Configuration

Hardware | Vendor  | Description
---------|---------|-------------------------------------------------
CPU      | Intel   | Intel(R) Core(TM) i3-3217U CPU @ 1.80GHz
Memory   | Corsair | Vengeance(R) 16GB (2x8GB) DDR3 1600 MT/s (CMSX16GX3M2B1600C9)
Disk     | Samsung | 250GB SSD 850 EVO mSATA (S248NXAH204096F)

## Results

Historical run, April 2018 (see configuration above).

**EPS vs yajs** = the library's Avg EPS as a percentage of yajs's Avg EPS on
the same dataset (`library EPS ÷ yajs EPS × 100`, computed from the Avg EPS
column). Lower means slower relative to yajs; yajs itself is the 100%
baseline (shown as `-`).

### Dataset 1 (2018, original three libraries)

Library    | Completed |   Time   | Avg EPS | EPS vs yajs
-----------|:---------:|:--------:|--------:|:-------:
yajs       | Yes       | 16.627 s | 126.50K | -
JSONStream | Yes       | 26.377 s | 78.21K  | 61.83%
oboe.js    | Yes       | 46.965 s | 43.34K  | 34.26%

### Dataset 1 (2026)

Freshly run against all four libraries via the current tsx-based harness
(`npm run bench`), Node v24.13.0, Linux x86_64, on a shared/loaded machine
(reference only - not a clean-room measurement; re-run locally for a
number you can rely on). EPS = final currentRate reported by
[measured](https://github.com/felixge/node-measured) at completion of all
2,000,000 objects in Dataset 1.

Library     | Avg EPS | EPS vs yajs
------------|--------:|:-------:
yajs        | 219.91K | -
JSONStream  | 363.47K | 165.28%
oboe.js     | 124.76K | 56.73%
stream-json | 14.63K  | 6.65%

Directionally consistent with the 2018 run (JSONStream competitive-to-faster,
oboe.js slower, both relative orderings unchanged); stream-json is
substantially slower than all three on this selector/dataset shape.

### Dataset 2

  Library  | Completed |      Time      | Avg EPS | EPS vs yajs
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 13 m, 52.066 s | 12.03K  | -
JSONStream | Yes       | 37 m, 55.946 s | 4.39K   | 36.49%
oboe.js    | Yes       | 51 m, 56.755 s | 3.21K   | 26.68%

### Dataset 3

  Library  | Completed |        Time    | Avg EPS | EPS vs yajs
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 20 m, 48.908 s | 12.02K  | -
JSONStream | Yes       | 57 m, 33.585 s | 4.20K   | 34.94%
oboe.js    | No        | -              | -       | -

### Dataset 4

  Library  | Completed |      Time      | Avg EPS | EPS vs yajs
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 8 m, 31.11 s   | 548.68K | -
JSONStream | Yes       | 51 m, 23.581 s | 90.82K  | 16.55%
oboe.js    | No        | -              | -       | -

*NOTE: oboe.js did not complete due to out of memory error.*
