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

`n_structure_100000_opening_arrays.json` (100,000 unclosed `[` characters)
used to be intentionally excluded from this directory: piping it through
yajs reliably exhausted the Node heap, so a copy that could take down the
whole test run had no place in a fixture directory a loop iterates over.
Fixed (GitHub issue #8) - StreamContext's dispatcher bookkeeping no longer
accumulates and re-dispatches to one entry per nesting level, so this
fixture now completes in well under a second using well under 100MB, even
under a constrained heap. The file is regenerated here (100,000 literal `[`
bytes, matching the upstream fixture's content) rather than fetched, since
it is entirely mechanical to reproduce.
