# Invariant: `browser-click` - Browser Click Script

> Clauses: 3 | Unwanted: 2 | Witnesses: app-dock-tools.test.ts:107-111

## Clauses
- buildClickScript dispatches a working pointer/mouse event sequence *(measured: app-dock-tools.test.ts:107-111)*
- Click on a button ref increments the counter in the live page *(measured: app-dock-tools.test.ts:107-111)*
- Click returns ok:true on success *(measured: app-dock-tools.test.ts:107-111)*

## Unwanted
- Click returns ok:false on a valid ref *(measured: app-dock-tools.test.ts:107-111)*
- Click does not mutate the live page state *(measured: app-dock-tools.test.ts:107-111)*

