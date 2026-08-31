import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.ts'],
    exclude: ['src/test/stream-tests/**', 'src/test/helpers/**'],
    coverage: {
      provider: 'v8',
      reporters: ['text', 'html'],
      // Coverage is still useful signal when a handful of tests are red
      // (e.g. flaky/property-based tests under active development), so
      // don't withhold the report just because `vitest run` exits non-zero.
      reportOnFailure: true,
      include: ['src/main/lib/**/*.ts', 'src/main/*.ts'],
      // Only the ANTLR-generated files are excluded here, matching
      // eslint.config.js's ignores list — src/main/lib/path/parser/utils.ts
      // is hand-written (not generated) and is linted, so it stays covered.
      exclude: [
        'src/main/lib/path/parser/YAJSLexer.ts',
        'src/main/lib/path/parser/YAJSParser.ts',
        'src/main/lib/path/parser/YAJSVisitor.ts',
        'src/test/**',
        'src/bench/**',
      ],
    },
  },
});
