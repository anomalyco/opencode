# Invariant: `fullscreen-command-validation` - Fullscreen and Command Validation

> Clauses: 2 | Unwanted: 2 | Witnesses: app-dock-security.test.ts:709-720

## Clauses
- Non-boolean fullscreen state is rejected with Invalid App Dock fullscreen state *(measured: app-dock-security.test.ts:709-720)*
- Invalid command enum is rejected with Invalid App Dock command *(measured: app-dock-security.test.ts:709-720)*

## Unwanted
- Non-boolean fullscreen state is accepted *(measured: app-dock-security.test.ts:709-720)*
- Invalid command enum is accepted *(measured: app-dock-security.test.ts:709-720)*

