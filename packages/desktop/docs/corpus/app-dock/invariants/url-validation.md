# Invariant: `url-validation` - URL Validation and Normalization

> Clauses: 6 | Unwanted: 3 | Witnesses: app-dock-utils.test.ts:14-22

## Clauses
- appDockURL accepts a valid HTTPS URL and returns it normalized *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts a bare domain and returns an HTTPS URL *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts a search term and returns a Google search HTTPS URL *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL rejects empty or whitespace-only input *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL rejects file: scheme *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL rejects javascript: scheme *(measured: app-dock-utils.test.ts:14-22)*

## Unwanted
- appDockURL accepts file: scheme URLs *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts javascript: scheme URLs *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts empty or whitespace-only input *(measured: app-dock-utils.test.ts:14-22)*

