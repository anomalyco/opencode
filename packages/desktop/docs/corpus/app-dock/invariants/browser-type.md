# Invariant: `browser-type` - Browser Type Script

> Clauses: 4 | Unwanted: 3 | Witnesses: app-dock-tools.test.ts:113-128

## Clauses
- buildTypeScript sets input value via native setter *(measured: app-dock-tools.test.ts:113-128)*
- Type fires input and change events on the element *(measured: app-dock-tools.test.ts:113-128)*
- Type returns ok:true and the typed value *(measured: app-dock-tools.test.ts:113-128)*
- Type handles textarea and contenteditable targets *(measured: app-dock-tools.test.ts:113-128)*

## Unwanted
- Type does not set the input value *(measured: app-dock-tools.test.ts:113-128)*
- Type does not fire input/change events *(measured: app-dock-tools.test.ts:113-128)*
- Type fails on textarea or contenteditable *(measured: app-dock-tools.test.ts:113-128)*

