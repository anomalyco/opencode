# Invariant: `restart-persistence` - Restart Persistence

> Clauses: 3 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:973-980

## Clauses
- Fresh Electron main process preserves same profile localStorage and cookie *(measured: app-dock-security.test.ts:973-980)*
- Deleted profile tombstone survives restart and blocks old partition access *(measured: app-dock-security.test.ts:973-980)*
- Separate profiles retain isolated storage across fresh Electron main process *(measured: app-dock-security.test.ts:973-980)*

## Unwanted
- Profile localStorage or cookie lost on restart *(measured: app-dock-security.test.ts:973-980)*
- Deleted profile tombstone does not survive restart *(measured: app-dock-security.test.ts:973-980)*
- Separate profiles share storage across restart *(measured: app-dock-security.test.ts:973-980)*

