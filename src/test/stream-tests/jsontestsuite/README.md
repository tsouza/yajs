# JSONTestSuite fixtures

These files are fetched verbatim from the `test_parsing/` directory of
[nst/JSONTestSuite](https://github.com/nst/JSONTestSuite), used here as the
conformance corpus exercised by `src/test/06-conformance.ts`.

JSONTestSuite is released under the MIT License:

> Copyright (c) 2016 Nicolas Seriot
>
> Permission is hereby granted, free of charge, to any person obtaining a
> copy of this software and associated documentation files (the
> "Software"), to deal in the Software without restriction, including
> without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit
> persons to whom the Software is furnished to do so, subject to the
> following conditions:
>
> The above copyright notice and this permission notice shall be included
> in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
> THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
> OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
> ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
> OTHER DEALINGS IN THE SOFTWARE.

One upstream fixture, `n_structure_100000_opening_arrays.json` (100,000
unclosed `[` characters), is intentionally **not** included here: piping it
through yajs reliably exhausts the Node heap (see the "known conformance
gaps" comments in `06-conformance.ts`), so a copy that can take down the
whole test run has no place in a fixture directory a loop iterates over.
