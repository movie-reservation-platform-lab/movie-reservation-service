import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', 'coverage/**', 'packages/audit-sdk/release/**', 'schema.gql'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts', '*.config.mjs', 'eslint.config.mjs', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['src/presentation/**/*.ts'],
    rules: {
      // Nest uses decorated classes as runtime metadata for DI and GraphQL.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['packages/audit-sdk/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./packages/audit-sdk/tsconfig.lint.json'],
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/audit-sdk/scripts/**/*.mjs'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: tseslint.configs.disableTypeChecked.rules,
  },
  {
    // Image smoke scripts run inside the CommonJS service image, so they use require().
    files: ['scripts/image-smoke/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['test/**/*.test.ts', 'automation/**/test/**/*.test.ts', 'packages/**/test/**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
