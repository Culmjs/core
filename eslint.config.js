import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      '.superpowers',
      'packages-private',
      '**/dist',
      '.pack',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['packages/core/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // anything that is not a relative path: node:*, @culmjs/*, bare specifiers
              regex: '^(?!\\.{1,2}/)',
              message: 'core imports only relative files',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'process',
        'Buffer',
        'require',
        'module',
        'global',
      ],
    },
  },
  {
    files: ['packages/tools/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // other packages by folder name; core is imported as @culmjs/core/<sub-path>
              regex: '^(\\.\\./)+(core|starter|packages)/',
              message:
                'tools src may not import by a relative path into another package',
            },
          ],
        },
      ],
    },
  },
)
