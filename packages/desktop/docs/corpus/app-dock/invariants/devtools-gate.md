# Invariant: `devtools-gate` - DevTools Gate

> Clauses: 3 | Unwanted: 3 | Witnesses: app-dock-security.test.ts:1162-1176

## Clauses
- App Dock DevTools do not open without trusted development route *(measured: app-dock-security.test.ts:1162-1176)*
- Ordinary user input (F12) does not open DevTools *(measured: app-dock-security.test.ts:1162-1176)*
- Trusted developmentMode()=true allows openDevTools *(measured: app-dock-security.test.ts:1162-1176)*

## Unwanted
- DevTools open without trusted route *(measured: app-dock-security.test.ts:1162-1176)*
- F12 opens DevTools in production mode *(measured: app-dock-security.test.ts:1162-1176)*
- developmentMode=true does not allow DevTools *(measured: app-dock-security.test.ts:1162-1176)*

