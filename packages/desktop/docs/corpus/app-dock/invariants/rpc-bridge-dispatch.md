# Invariant: `rpc-bridge-dispatch` - RPC Bridge Dispatch

> Clauses: 12 | Unwanted: 6 | Witnesses: app-dock-rpc.test.ts:103-145

## Clauses
- handleDockRPC consumes only messages with type dock.rpc and ignores others *(measured: app-dock-rpc.test.ts:103-145)*
- handleDockRPC returns true when it consumes a dock.rpc message *(measured: app-dock-rpc.test.ts:103-145)*
- handleDockRPC returns false for non-dock messages *(measured: app-dock-rpc.test.ts:103-145)*
- Unknown dock operations return an error result with ok:false *(measured: app-dock-rpc.test.ts:103-145)*
- open with non-HTTPS address returns an error result mentioning HTTPS *(measured: app-dock-rpc.test.ts:103-145)*
- open with valid HTTPS address returns ok:true with tabID and URL *(measured: app-dock-rpc.test.ts:103-145)*
- list returns the opened tab with tabID and active:true *(measured: app-dock-rpc.test.ts:103-145)*
- read returns a page snapshot with items containing refs for interactive elements *(measured: app-dock-rpc.test.ts:103-145)*
- click on a button ref returns ok:true and mutates the live page *(measured: app-dock-rpc.test.ts:103-145)*
- type on an input ref sets the value and reflects in subsequent snapshot *(measured: app-dock-rpc.test.ts:103-145)*
- go reload returns ok:true and preserves the tab *(measured: app-dock-rpc.test.ts:103-145)*
- close returns ok:true and empties the tab list *(measured: app-dock-rpc.test.ts:103-145)*

## Unwanted
- handleDockRPC consumes non-dock.rpc messages *(measured: app-dock-rpc.test.ts:103-145)*
- Unknown operations return ok:true *(measured: app-dock-rpc.test.ts:103-145)*
- Non-HTTPS open returns ok:true *(measured: app-dock-rpc.test.ts:103-145)*
- Click or type reports failure on valid refs *(measured: app-dock-rpc.test.ts:103-145)*
- go reload loses the tab *(measured: app-dock-rpc.test.ts:103-145)*
- close leaves tabs in the list *(measured: app-dock-rpc.test.ts:103-145)*

