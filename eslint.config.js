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
  // starter src imports only @culmjs/core (the root) and relative files that
  // stay inside packages/starter (any depth, any JS/TS extension).
  {
    files: ['packages/starter/src/**/*.{ts,mts,cts,js,mjs,cjs,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/|@culmjs/core$)',
              message: 'starter imports only @culmjs/core and its own files',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportExpression > Literal[value=/^(?!\\.{1,2}\\x2f|@culmjs\\x2fcore$)/]',
          message:
            'starter imports only @culmjs/core and its own files, inside packages/starter',
        },
        {
          selector:
            'ImportExpression > TemplateLiteral[quasis.0.value.raw=/^(?!\\.{1,2}\\x2f|@culmjs\\x2fcore$)/]',
          message:
            'starter imports only @culmjs/core and its own files, inside packages/starter',
        },
      ],
    },
  },
  ...Array.from({ length: 8 }, (_, depth) => {
    const out = `^(\\./)*(\\.\\./(\\./)*){${depth + 2},}`
    return {
      files: [
        `packages/starter/src/${'*/'.repeat(depth)}*.{ts,mts,cts,js,mjs,cjs,tsx}`,
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^(?!\\.{1,2}/|@culmjs/core$)',
                message: 'starter imports only @culmjs/core and its own files',
              },
              {
                regex: out,
                message: 'starter src may not import outside packages/starter',
              },
            ],
          },
        ],
        // no-restricted-imports does not see import()
        'no-restricted-syntax': [
          'error',
          {
            selector: `ImportExpression > Literal[value=/^(?!\\.{1,2}\\x2f|@culmjs\\x2fcore$)|${out.replaceAll('/', '\\x2f')}/]`,
            message:
              'starter imports only @culmjs/core and its own files, inside packages/starter',
          },
          {
            selector: `ImportExpression > TemplateLiteral[quasis.0.value.raw=/^(?!\\.{1,2}\\x2f|@culmjs\\x2fcore$)|${out.replaceAll('/', '\\x2f')}/]`,
            message:
              'starter imports only @culmjs/core and its own files, inside packages/starter',
          },
        ],
      },
    }
  }),
  // tools src and bin may not import by a relative path that resolves outside
  // packages/tools/ (core is imported as @culmjs/core/<sub-path>). A file
  // `depth` folders under src/bin needs depth + 2 climbs to leave the package.
  ...Array.from({ length: 8 }, (_, depth) => {
    const out = `^(\\./)*(\\.\\./(\\./)*){${depth + 2},}`
    const dir = '*/'.repeat(depth)
    return {
      files: [
        `packages/tools/src/${dir}*.{ts,mts,cts,js,mjs,cjs,tsx}`,
        `packages/tools/bin/${dir}*.{ts,mts,cts,js,mjs,cjs,tsx}`,
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: out,
                message:
                  'tools src may not import by a relative path outside packages/tools',
              },
            ],
          },
        ],
        // no-restricted-imports does not see import()
        'no-restricted-syntax': [
          'error',
          {
            selector: `ImportExpression > Literal[value=/${out.replaceAll('/', '\\x2f')}/]`,
            message:
              'tools src may not import by a relative path outside packages/tools',
          },
          {
            selector: `ImportExpression > TemplateLiteral[quasis.0.value.raw=/${out.replaceAll('/', '\\x2f')}/]`,
            message:
              'tools src may not import by a relative path outside packages/tools',
          },
        ],
      },
    }
  }),
)
