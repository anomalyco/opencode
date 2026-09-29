# Invariant: `zoom-clamping` - Zoom Clamping

> Clauses: 4 | Unwanted: 1 | Witnesses: app-dock-utils.test.ts:24-29

## Clauses
- appDockZoom clamps values below 0.5 up to 0.5 *(measured: app-dock-utils.test.ts:24-29)*
- appDockZoom clamps values above 3 down to 3 *(measured: app-dock-utils.test.ts:24-29)*
- appDockZoom passes through values within [0.5, 3] unchanged *(measured: app-dock-utils.test.ts:24-29)*
- appDockZoom throws on NaN or non-finite input *(measured: app-dock-utils.test.ts:24-29)*

## Unwanted
- appDockZoom accepts NaN or non-finite input *(measured: app-dock-utils.test.ts:24-29)*

