# Benchmark

This is a benchmark comparing yajs with other two json streaming js libraries: [oboe.js](https://github.com/jimhigson/oboe.js) and [JSONStream](https://github.com/dominictarr/JSONStream).

## Method

For each library, a sequence of different datasets was used to process with equivalent selection path. It was measured the total time of execution and also the rate of the objects produced per second (EPS) using [measured](https://github.com/felixge/node-measured).

See [bench](src/bench) for more details 

*Note: Due to the large size of the datasets, they are gzipped on disk and are gunzipped on the fly before feeding the library.*

## Datasets

Dataset   | Format | Size  | Object size | Objects | Root Type
----------|--------|-------|-------------|---------|----------
Dataset 1 | ndjson | 76MB  | 80B         | 1M      | object
Dataset 2 | ndjson | 10GB  | 5.3KB       | 2M      | object
Dataset 3 | json   | 15GB  | 5.3KB       | 3M      | array
Dataset 4 | json   | 5.2GB | 5.2GB       | 1       | object

### Selection paths

Library/Dataset | Dataset 1            | Dataset 2               | Dataset 3                  | Dataset 4 
----------------|----------------------|-------------------------|----------------------------|--------------------
yajs            | `$.field2.nested`    | `$..plugins`            | `$..plugins`               | `$..array.deep1`
JSONStream      | `field2.nested.*`    | `!._source..plugins[*]` | `![*]._source..plugins[*]` | `!..array[*].deep1`
oboe.js         | `!.field2.nested[*]` | `_source..plugins.*`    | `*._source..plugins.*`     | `*..array.*.deep1`

## Software Configuration

Software    | Version
------------|-----------------------------------------
OS          | Ubuntu 17.10 (kernel 4.13.0-25-generic)
Node.js     | v9.4.0
yajs        | 1.1.7
oboe.js     | 2.1.4
JSONStream  | 1.3.2

## Hardware Configuration

Hardware | Vendor  | Description
---------|---------|-------------------------------------------------
CPU      | Intel   | Intel(R) Core(TM) i3-3217U CPU @ 1.80GHz
Memory   | Corsair | Vengance(R) 16GB (2x8GB) DDR3 1600 MT/s (CMSX16GX3M2B1600C9)
Disk     | Samsung | 250GB SSD 850 EVO mSATA (S248NXAH204096F)

## Results

### Dataset 1

Library     | Completed | Total Time | Avg EPS | % Drop 
------------|:---------:|:----------:|:-------:|:-------:
yajs        | Yes       | 21.049s    | 104.74k | -
JSONStream  | Yes       | 27.118s    | 75.88k  | 38%
oboe.js     | Yes       | 46.59s     | 43.66k  | 140%

### Dataset 2

Library     | Completed | Total Time  | Avg EPS | % Drop 
------------|:---------:|:-----------:|:-------:|:-------:
yajs        | Yes       | 18m 29.662s | 9.03k   | -
JSONStream  | Yes       | 39m 48.891s | 4.19k   | 116%
oboe.js     | Yes       | 48m 22.562s | 3.45k   | 162%

### Dataset 3

Library     | Completed | Total Time     | Avg EPS | % Drop 
------------|:---------:|:--------------:|:-------:|:-------:
yajs        | Yes       | 0h 27m 16.705s | 9.18k   | -
JSONStream  | Yes       | 1h 01m 13.118s | 4.08k   | 125%
oboe.js     | No        | -              | -       | -

### Dataset 4

Library     | Completed | Total Time  | Avg EPS | % Drop 
------------|:---------:|:-----------:|:-------:|:-------:
yajs        | Yes       | 12m 48.436s | 365.32k | -
JSONStream  | Yes       | 51m 49.401s | 90.07k  | 306%
oboe.js     | No        | -           | -       | -

*Note: oboe.js did not complete due to out of memory error*