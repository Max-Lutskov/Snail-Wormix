import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', '.claude/'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // Rendering layer and entry point run in the browser.
  {
    files: ['src/game/**/*.ts', 'src/main.ts'],
    languageOptions: { globals: globals.browser },
  },

  // The room server runs on Node.
  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Core must stay pure and deterministic: no Phaser, no DOM, no wall clock, no Math.random.
  // The same code runs on the server and in replays.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['phaser', 'phaser/*'], message: 'src/core must not depend on Phaser.' },
            {
              group: ['**/game/**', '../game', '../game/*'],
              message: 'src/core must not import from src/game.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'localStorage',
          'requestAnimationFrame',
          'setTimeout',
          'setInterval',
          'performance',
        ].map((name) => ({
          name,
          message: 'src/core must not touch the browser or wall-clock time.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG from core/rng.' },
        {
          object: 'Date',
          property: 'now',
          message: 'Core time comes from the fixed simulation step.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Core time comes from the fixed simulation step.',
        },
      ],
    },
  },

  // Tooling config files run in Node and are outside the TS project rules.
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
