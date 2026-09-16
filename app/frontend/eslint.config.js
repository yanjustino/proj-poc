import js from '@eslint/js';

// Minimal on purpose: this exists specifically to catch the class of bug
// that slipped through silently for several turns (a dangling call to a
// function whose definition had been deleted — logTransition() in
// run-tracker.js) — `go build`/`go test`/`npm run build` (Vite/esbuild)
// none of them flag a reference to an undefined identifier in plain JS.
// `no-undef` (part of the recommended set) is exactly the rule that would
// have caught it immediately.
export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Not this codebase's convention (plain `throw new Error(...)` without
      // cause-chaining is used deliberately everywhere) — off by default in
      // eslint:recommended too until a recent version turned it on.
      'preserve-caught-error': 'off',
    },
  },
];
