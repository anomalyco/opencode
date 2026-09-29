# Invariant: `https-only` - HTTPS-Only Enforcement

> Clauses: 2 | Unwanted: 2 | Witnesses: app-dock-security.test.ts:504-529

## Clauses
- open rejects http, file, javascript, data schemes with HTTPS-only error *(measured: app-dock-security.test.ts:504-529)*
- navigate rejects http, file, javascript, data schemes with HTTPS-only error *(measured: app-dock-security.test.ts:504-529)*

## Unwanted
- open accepts non-HTTPS schemes *(measured: app-dock-security.test.ts:504-529)*
- navigate accepts non-HTTPS schemes *(measured: app-dock-security.test.ts:504-529)*

