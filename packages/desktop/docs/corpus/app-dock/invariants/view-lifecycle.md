# Invariant: `view-lifecycle` - View Lifecycle

> Clauses: 2 | Unwanted: 2 | Witnesses: app-dock-security.test.ts:618-630

## Clauses
- Close destroys the WebContentsView immediately *(measured: app-dock-security.test.ts:618-630)*
- Closed identity emits no scheduled events after destruction (500ms grace) *(measured: app-dock-security.test.ts:618-630)*

## Unwanted
- Closed WebContentsView remains alive *(measured: app-dock-security.test.ts:618-630)*
- Closed identity emits stale events after destruction *(measured: app-dock-security.test.ts:618-630)*

