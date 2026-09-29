# Invariant: `throttling` - Hide/Select Throttling

> Clauses: 2 | Unwanted: 2 | Witnesses: app-dock-security.test.ts:721-757

## Clauses
- Hide throttles a 25ms ticker to at most one tick in 300ms *(measured: app-dock-security.test.ts:721-757)*
- Select resumes three ticks within 200ms *(measured: app-dock-security.test.ts:721-757)*

## Unwanted
- Hidden ticker is not throttled *(measured: app-dock-security.test.ts:721-757)*
- Selected ticker does not resume within 200ms *(measured: app-dock-security.test.ts:721-757)*

