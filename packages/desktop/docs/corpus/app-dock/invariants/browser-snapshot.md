# Invariant: `browser-snapshot` - Browser Snapshot Script

> Clauses: 5 | Unwanted: 4 | Witnesses: app-dock-tools.test.ts:86-105

## Clauses
- buildSnapshotScript returns an object with url, title, viewport, items[], text *(measured: app-dock-tools.test.ts:86-105)*
- items contains interactive elements with unique positive integer refs *(measured: app-dock-tools.test.ts:86-105)*
- items includes element kinds: button, input, a, div (contenteditable), textarea *(measured: app-dock-tools.test.ts:86-105)*
- Refs are stable across repeated snapshots of the same page *(measured: app-dock-tools.test.ts:86-105)*
- Budget parameter clamps item count and sets truncated:true when exceeded *(measured: app-dock-tools.test.ts:86-105)*

## Unwanted
- Snapshot lacks url, title, viewport, items, or text *(measured: app-dock-tools.test.ts:86-105)*
- Refs are not positive integers or are duplicated *(measured: app-dock-tools.test.ts:86-105)*
- Hidden or aria-hidden inert elements appear in snapshot *(measured: app-dock-tools.test.ts:86-105)*
- Budget cap is not honored or truncated flag is not set *(measured: app-dock-tools.test.ts:86-105)*

