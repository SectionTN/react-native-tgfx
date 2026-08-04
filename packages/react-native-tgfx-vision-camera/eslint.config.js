const js = require('@eslint/js')
const prettier = require('eslint-config-prettier/flat')
const tseslint = require('@typescript-eslint/eslint-plugin')
const tsparser = require('@typescript-eslint/parser')

module.exports = [
  {
    ignores: ['node_modules/**', 'lib/**', 'nitrogen/**', 'cpp/**'],
  },
  js.configs.recommended,
  {
    files: ['*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-undef': 'off',
    },
  },
  prettier,
]
