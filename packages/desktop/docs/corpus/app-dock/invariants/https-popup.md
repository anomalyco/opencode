# Invariant: `https-popup` - HTTPS Popup Handling

> Clauses: 4 | Unwanted: 4 | Witnesses: app-dock-security.test.ts:874-917

## Clauses
- HTTPS window.open emits tab-opened with cloneable public identity (tabID, generation, url) *(measured: app-dock-security.test.ts:874-917)*
- HTTPS popup creates second WebContentsView *(measured: app-dock-security.test.ts:874-917)*
- HTTPS popup target loads and is selected and attached *(measured: app-dock-security.test.ts:874-917)*
- Popup source view is hidden and detached *(measured: app-dock-security.test.ts:874-917)*

## Unwanted
- HTTPS popup does not emit tab-opened *(measured: app-dock-security.test.ts:874-917)*
- HTTPS popup does not create second view *(measured: app-dock-security.test.ts:874-917)*
- Popup target does not load or is not selected *(measured: app-dock-security.test.ts:874-917)*
- Popup source remains attached *(measured: app-dock-security.test.ts:874-917)*

