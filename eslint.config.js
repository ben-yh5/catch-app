// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
    ...expoConfig,
    {
        ignores: ['dist/*', 'node_modules/*', '.expo/*'],
    },
    {
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
            },
        },
        settings: {
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                },
                node: {
                    extensions: ['.js', '.jsx', '.ts', '.tsx'],
                },
            },
        },
    },
])
