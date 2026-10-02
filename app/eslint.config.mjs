import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ponytail: flat config, no framework-specific plugins until a rule actually fails.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'src-tauri/target/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      // Empty catch is legitimate in parser recovery; the plan's own contract
      // (`try a candidate schema, fall through`) depends on it.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // §16.1 forbids an `any` escape hatch for envelope/voice-map payloads. Code
      // genuinely holding unknown model JSON types it as `unknown` instead.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
];