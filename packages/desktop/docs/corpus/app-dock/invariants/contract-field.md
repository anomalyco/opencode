# Invariant: `contract-field` - Contract Field Minimality

> Clauses: 3 | Unwanted: 2 | Witnesses: app-dock-security.test.ts:928-972

## Clauses
- Open and tab-opened contracts expose only tabID, generation, and URL *(measured: app-dock-security.test.ts:928-972)*
- Event envelopes omit legacy id and adapter fields *(measured: app-dock-security.test.ts:928-972)*
- State, tab-opened, and navigation-error events are cloneable public identities *(measured: app-dock-security.test.ts:928-972)*

## Unwanted
- Open or tab-opened exposes id, storageKey, path, or adapter fields *(measured: app-dock-security.test.ts:928-972)*
- Event envelopes expose legacy id or adapter fields *(measured: app-dock-security.test.ts:928-972)*

