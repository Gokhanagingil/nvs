import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'artifacts/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['ops/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-control-regex': 'off',
    },
  },
);
