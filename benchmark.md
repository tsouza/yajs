# Benchmark

This is a benchmark comparing yajs with other two json streaming js libraries: [oboe.js](https://github.com/jimhigson/oboe.js) and [JSONStream](https://github.com/dominictarr/JSONStream).

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

Dataset/Library   | yajs              | JSONStream             | oboe.js
:----------------:|-------------------|------------------------|----------------------------
1                 | `$.field2.nested` | `field2.nested.*`      | `!.field2.nested[*]`
2                 | `$..plugins`      | `_source..plugins.*`   | `!._source..plugins[*]`
3                 | `$..plugins`      | `*._source..plugins.*` | `![*]._source..plugins[*]`
4                 | `$..array.deep1`  | `*..array.*.deep1`     | `!..array[*].deep1`

## Software Configuration

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

### Dataset 1

Library    | Completed |   Time   | Avg EPS | % Diff
-----------|:---------:|:--------:|--------:|:-------:
yajs       | Yes       | 16.627 s | 126.50K | -
JSONStream | Yes       | 26.377 s | 78.21K  | 61.74%
oboe.js    | Yes       | 46.965 s | 43.34K  | 191.85%

### Dataset 2

  Library  | Completed |      Time      | Avg EPS | % Diff
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 13 m, 52.066 s | 12.03K  | -
JSONStream | Yes       | 37 m, 55.946 s | 4.39K   | 173.68%
oboe.js    | Yes       | 51 m, 56.755 s | 3.21K   | 74.81%

### Dataset 3

  Library  | Completed |        Time    | Avg EPS | % Diff
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 20 m, 48.908 s | 12.02K  | -
JSONStream | Yes       | 57 m, 33.585 s | 4.20K   | 176.66%
oboe.js    | No        | -              | -       | -

### Dataset 4

  Library  | Completed |      Time      | Avg EPS | % Diff
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 8 m, 31.11 s   | 548.68K | -
JSONStream | Yes       | 51 m, 23.581 s | 90.82K  | 504.13%
oboe.js    | No        | -              | -       | -

*NOTE: oboe.js did not complete due to out of memory error.*