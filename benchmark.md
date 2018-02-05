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
OS          | Ubuntu 17.10 (kernel 4.13.0-25-generic)
Node.js     | v9.4.0
yajs        | 1.1.11
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

Library    | Completed |   Time   | Avg EPS | % Drop
-----------|:---------:|:--------:|--------:|:-------:
yajs       | Yes       | 19.679 s | 112.82K | -
JSONstream | Yes       | 28.032 s | 73.35K  | 53.82%
oboe.js    | Yes       | 47.899 s | 42.45K  | 165.77%

### Dataset 2

  Library  | Completed |      Time      | Avg EPS | % Drop
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 18 m, 8.521 s  | 9.20K   | -
JSONStream | Yes       | 39 m, 24.74 s  | 4.23K   | 117.56%
oboe.js    | Yes       | 49 m, 53.019 s | 3.34K   | 175.38%

### Dataset 3

  Library  | Completed |        Time        | Avg EPS | % Drop
-----------|:---------:|:------------------:|:-------:|:-------:
yajs       | Yes       | 26 m, 43.94 s      | 9.36K   | -
JSONStream | Yes       | 1 h, 1 m, 33.646 s | 4.06K   | 130.52%
oboe.js    | No        | -                  | -       | -

### Dataset 4

  Library  | Completed |      Time      | Avg EPS | % Drop
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 11 m, 58.023 s | 391.03K | -
JSONStream | Yes       | 52 m, 25.399 s | 89.04K  | 339.16%
oboe.js    | No        | -              | -       | -

*NOTE: oboe.js did not complete due to out of memory error.*