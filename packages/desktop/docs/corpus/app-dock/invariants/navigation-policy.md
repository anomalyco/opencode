# Invariant: `navigation-policy` - Navigation Policy

> Clauses: 3 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:532-566

## Clauses
- Real window.open to non-HTTPS target is blocked with navigation-error *(measured: app-dock-security.test.ts:532-566)*
- Real main-frame navigation to non-HTTPS target is blocked *(measured: app-dock-security.test.ts:532-566)*
- Real HTTPS redirect to HTTP is blocked with navigation-error *(measured: app-dock-security.test.ts:532-566)*

## Unwanted
- window.open to non-HTTPS succeeds *(measured: app-dock-security.test.ts:532-566)*
- Main-frame navigation to non-HTTPS succeeds *(measured: app-dock-security.test.ts:532-566)*
- HTTPS redirect to HTTP succeeds *(measured: app-dock-security.test.ts:532-566)*

