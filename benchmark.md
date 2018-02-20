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
yajs        | 1.2.0
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
yajs       | Yes       | 20.495 s | 108.55K | -
JSONstream | Yes       | 27.227 s | 75.60K  | 43.59%
oboe.js    | Yes       | 46.54 s  | 43.70K  | 148.37%

### Dataset 2

  Library  | Completed |     Time      | Avg EPS | % Diff
-----------|:---------:|:-------------:|:-------:|:-------:
yajs       | Yes       | 14 m, 55.52 s | 11.19K  | -
JSONstream | Yes       | 39 m, 1.709 s | 4.27K   | 161.98%
oboe.js    | Yes       | 51 m, 3.245 s | 3.27K   | 242.73%

### Dataset 3

  Library  | Completed |        Time    | Avg EPS | % Diff
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 22 m, 7.247 s  | 11.32K  | -
JSONstream | Yes       | 59 m, 29.688 s | 4.20K   | 169.30%
oboe.js    | No        | -              | -       | -

### Dataset 4

  Library  | Completed |      Time      | Avg EPS | % Diff
-----------|:---------:|:--------------:|:-------:|:-------:
yajs       | Yes       | 12 m, 41.935 s | 368.44K | -
JSONstream | Yes       | 52 m, 32.502 s | 88.84K  | 314.73%
oboe.js    | No        | -              | -       | -

*NOTE: oboe.js did not complete due to out of memory error.*