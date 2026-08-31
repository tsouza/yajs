// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    // This is a TypeScript project; plain JS infra files (this config, the
    // legacy dual-CJS/ESM entry point src/main/main.js, dist output) are not
    // linted. Generated ANTLR parser output is hand-generated, not
    // hand-written, and is excluded too.
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'eslint.config.js',
      'src/main/main.js',
      'src/main/lib/path/parser/YAJSLexer.ts',
      'src/main/lib/path/parser/YAJSParser.ts',
      'src/main/lib/path/parser/YAJSVisitor.ts',
    ],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    rules: {
      // Roughly preserve tslint.json's intent:
      //   "member-access": [true, "no-public"] -> don't write the redundant `public` keyword
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],
      // "quotemark": [true, "single"]
      quotes: ['error', 'single', { avoidEscape: true }],
      // "no-namespace": false - the codebase uses `namespace Foo { ... }`
      // merged with a same-named class/function as an idiomatic "static
      // members" pattern (e.g. PathOperator, YAJSPath, JsonSaxParser).
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // vitest's expect() uses the chai BDD API (`expect(x).to.exist`,
    // `.to.be.empty`, etc.), which are assertions written as bare property
    // access / expression statements - not a real "unused expression" bug.
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
);
