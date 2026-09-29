# Invariant: `dock-scroll` - Dock Scroll

> Clauses: 2 | Unwanted: 1 | Witnesses: app-dock-live.test.ts

## Clauses
- dock_scroll dispatches scroll and rejects invalid direction or amount *(measured: app-dock-live.test.ts)*
- RPC dispatch validates scroll direction against up, down, top, bottom *(measured: app-dock-live.test.ts)*

## Unwanted
- dock_scroll accepts invalid direction *(measured: app-dock-live.test.ts)*

