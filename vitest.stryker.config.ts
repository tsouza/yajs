import { defineConfig } from 'vitest/config';

// Mutation-testing-only Vitest config (see stryker.conf.json / CONTRIBUTING
// notes on running Stryker). Identical to vitest.config.ts except it also
// excludes src/test/06-conformance.ts.
//
// That suite only ever calls yajs('$') (the plain root selector - see its
// own comments), so it contributes no meaningful coverage of the
// wildcard/descendant/array-index logic Stryker mutates in
// src/main/lib/path/ and src/main/lib/context/. It DOES, however, include
// two fixtures (n_structure_100000_opening_arrays.json,
// n_structure_open_array_object.json) that settle only via a quiet-period/
// hard-cap timer (1s/5s) rather than a normal event - fine for a single
// `vitest run`, but Stryker's coverage-instrumented dry run and its
// mutant-by-mutant re-execution both add enough overhead that this timer
// flakes under the load a mutation testing run generates (confirmed: it
// failed the dry run twice in a row with "expected at least one error
// event" - zero errors observed within the hard cap). Since the file adds
// no mutation-coverage value here, excluding it keeps the mutation run both
// fast and deterministic instead of load-dependent.
export default defineConfig({
  test: {
    include: ['src/test/**/*.ts'],
    exclude: ['src/test/stream-tests/**', 'src/test/helpers/**', 'src/test/06-conformance.ts'],
  },
});
