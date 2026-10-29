import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

//Flat config (ESLint 9) ported from the former .eslintrc.cjs, which ESLint 9 no longer reads.
//The style rules are the ones the JavaScript files were written for. TypeScript files are only parsed
//and checked for unused variables, they follow the formatting of the typescript code base instead.
export default [
    {
        ignores: ['**/*.ignore.*', '**/*.d.ts', 'node_modules/**', 'dist/**', 'tmp_core_tsc/**'],
    },
    {
        files: ['**/*.{js,cjs,mjs}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                GlobalData: 'writable',
                ExecuteCommand: 'readonly',
                GetConvar: 'readonly',
                GetCurrentResourceName: 'readonly',
                GetPasswordHash: 'readonly',
                GetResourceMetadata: 'readonly',
                GetResourcePath: 'readonly',
                IsDuplicityVersion: 'readonly',
                VerifyPasswordHash: 'readonly',
            },
        },
        rules: {
            //Review these
            'no-control-regex': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-prototype-builtins': 'off',
            'no-unused-vars': ['warn', {
                varsIgnorePattern: '^_\\w*',
                vars: 'all',
                args: 'none', //diff
                ignoreRestSiblings: true,
            }],

            //From Airbnb, fixed them already
            'keyword-spacing': ['error', {
                before: true,
                after: true,
                overrides: {
                    return: { after: true },
                    throw: { after: true },
                    case: { after: true },
                },
            }],
            'space-before-blocks': 'error',
            quotes: ['error', 'single', { allowTemplateLiterals: true }],
            semi: ['error', 'always'],
            'no-trailing-spaces': ['error', {
                skipBlankLines: false,
                ignoreComments: false,
            }],
            'space-infix-ops': 'error',
            'comma-dangle': ['error', {
                arrays: 'always-multiline',
                objects: 'always-multiline',
                imports: 'always-multiline',
                exports: 'always-multiline',
                functions: 'always-multiline',
            }],
            'padded-blocks': ['error', {
                blocks: 'never',
                classes: 'never',
                switches: 'never',
            }, {
                allowSingleLineBlocks: true,
            }],
            'comma-spacing': ['error', { before: false, after: true }],
            'arrow-spacing': ['error', { before: true, after: true }],
            'arrow-parens': ['error', 'always'],
            'operator-linebreak': ['error', 'before', { overrides: { '=': 'none' } }],

            // Custom
            indent: ['error', 4],

            // FIXME: re-enable it somewhen
            'linebreak-style': 'off',
            'spaced-comment': 'off',
            'object-curly-spacing': 'off', //maybe keep this disabled?
            'arrow-body-style': 'off', //maybe keep this disabled?
        },
    },
    {
        files: ['**/*.ts'],
        plugins: { '@typescript-eslint': tsPlugin },
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', {
                varsIgnorePattern: '^_\\w*',
                vars: 'all',
                args: 'none',
                ignoreRestSiblings: true,
            }],
        },
    },
];
