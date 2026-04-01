import prettier from 'eslint-config-prettier'
import js from '@eslint/js'
import { includeIgnoreFile } from '@eslint/compat'
import globals from 'globals'
import { globalIgnores } from 'eslint/config'
import { fileURLToPath, URL } from 'node:url'
import ts from 'typescript-eslint'

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url))

export default ts.config(
	includeIgnoreFile(gitignorePath, 'Imported gitignore file'),
	js.configs.recommended,
	...ts.configs.strict,
	prettier,
	{
		files: ['**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
				...globals.es2024
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_'
				}
			]
		}
	},
	globalIgnores(['**/worker-configuration.d.ts'])
)
