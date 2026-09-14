import { config } from '@n8n/node-cli/eslint';
import { globalIgnores } from 'eslint/config';

/**
 * The n8n community-node config, unchanged for everything that ships.
 *
 * `test/` never reaches an n8n instance (`package.json` publishes `dist` only),
 * so the two n8n-Cloud runtime rules below are switched off there: the suite
 * imports `node:test`/`node:assert`, and its signing vectors are fixed fake
 * values the secret scanner reads as credentials. Every other rule still
 * applies to the tests.
 */
export default [
	...config,
	globalIgnores(['dist', 'dist-test']),
	{
		files: ['test/**/*.ts'],
		rules: {
			'@n8n/community-nodes/no-restricted-imports': 'off',
			'@n8n/community-nodes/no-hardcoded-secrets': 'off',
		},
	},
];
