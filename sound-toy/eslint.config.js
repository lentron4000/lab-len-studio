// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-single', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      // Typed arrays and hot loops index by number constantly; the template/number rules add noise there.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['build/**', 'vite.config.ts', 'tests/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
