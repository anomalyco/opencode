# Invariant: `navigation-error-envelope` - Navigation Error Envelope

> Clauses: 3 | Unwanted: 2 | Witnesses: app-dock-security.test.ts:603-611

## Clauses
- Navigation error envelope is discriminated with tabID and generation *(measured: app-dock-security.test.ts:603-611)*
- Navigation error code is either blocked or failed *(measured: app-dock-security.test.ts:603-611)*
- Navigation error identity contains tabID (string) and generation (safe integer) *(measured: app-dock-security.test.ts:603-611)*

## Unwanted
- Navigation error lacks discriminated identity *(measured: app-dock-security.test.ts:603-611)*
- Navigation error code is neither blocked nor failed *(measured: app-dock-security.test.ts:603-611)*

