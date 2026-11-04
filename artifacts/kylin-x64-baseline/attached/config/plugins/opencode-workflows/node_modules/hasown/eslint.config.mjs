import ljharbConfig from '@ljharb/eslint-config/flat';

export default [
	...ljharbConfig,
	{ rules: { 'no-extra-parens': 'off' } },
];
