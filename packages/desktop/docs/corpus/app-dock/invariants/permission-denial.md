# Invariant: `permission-denial` - Permission Denial

> Clauses: 4 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:577-601

## Clauses
- Permission request is denied (state: denied) *(measured: app-dock-security.test.ts:577-601)*
- Permission check returns denied *(measured: app-dock-security.test.ts:577-601)*
- Permission denial emits App Dock UI state with identity and permission name *(measured: app-dock-security.test.ts:577-601)*
- Permission event is cloneable and omits storage data *(measured: app-dock-security.test.ts:577-601)*

## Unwanted
- Permission request is granted *(measured: app-dock-security.test.ts:577-601)*
- Permission check returns granted *(measured: app-dock-security.test.ts:577-601)*
- Permission event exposes storageKey or user data path *(measured: app-dock-security.test.ts:577-601)*

