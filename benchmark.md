# Benchmark

This is a benchmark comparing yajs with other two json streaming js libraries: [oboe.js](https://github.com/jimhigson/oboe.js) and [JSONStream](https://github.com/dominictarr/JSONStream).

## Method

For each library, a sequence of different datasets was used to process with equivalent selection path. It was measured the total time of execution and also the rate of the objects produced per second (EPS) using [measured](https://github.com/felixge/node-measured).

See [bench](src/bench) for more details

*Note: Due to the large size of the datasets, they are gzipped on disk and are gunzipped on the fly before feeding the library.*

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
yajs        | 1.1.10
oboe.js     | 2.1.4
JSONStream  | 1.3.2

## Hardware Configuration

Hardware | Vendor  | Description
---------|---------|-------------------------------------------------
CPU      | Intel   | Intel(R) Core(TM) i3-3217U CPU @ 1.80GHz
Memory   | Corsair | Vengeance(R) 16GB (2x8GB) DDR3 1600 MT/s (CMSX16GX3M2B1600C9)
Disk     | Samsung | 250GB SSD 850 EVO mSATA (S248NXAH204096F)

## Results

### Dataset 1

Library     | Completed | Total Time | Avg EPS | % Drop
------------|:---------:|:----------:|:-------:|:-------:
yajs        | Yes       | 21.400s    | 102.91k | -
JSONStream  | Yes       | 27.428s    | 75.03k  | 37%
oboe.js     | Yes       | 46.568s    | 43.68k  | 136%

### Dataset 2

Library     | Completed | Total Time  | Avg EPS | % Drop
------------|:---------:|:-----------:|:-------:|:-------:
yajs        | Yes       | 18m 14.663s | 9.15k   | -
JSONStream  | Yes       | 39m 32.675s | 4.22k   | 117%
oboe.js     | Yes       | 49m 06.582s | 3.39k   | 170%

### Dataset 3

Library     | Completed | Total Time  | Avg EPS | % Drop
------------|:---------:|:-----------:|:-------:|:-------:
yajs        | Yes       | 27m 41.419s | 9.18k   | -
JSONStream  | Yes       | 59m 53.814s | 4.08k   | 119%
oboe.js     | No        | -           | -       | -

### Dataset 4

Library     | Completed | Total Time  | Avg EPS | % Drop
------------|:---------:|:-----------:|:-------:|:-------:
yajs        | Yes       | 12m 33.618s | 372.51k | -
JSONStream  | Yes       | 51m 58.657s | 89.79k  | 315%
oboe.js     | No        | -           | -       | -

*Note: oboe.js did not complete due to out of memory error*