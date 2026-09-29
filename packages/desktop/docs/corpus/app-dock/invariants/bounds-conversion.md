# Invariant: `bounds-conversion` - Bounds Conversion

> Clauses: 5 | Unwanted: 3 | Witnesses: app-dock-utils.test.ts:4-12

## Clauses
- panelBoundsToContent converts CSS bounds to content bounds by dividing by zoom *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rejects bounds with non-positive width or height *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rejects zoom values that are not finite or not positive *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rejects bounds that produce non-positive content bounds after division *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rounds x, y, width, height after division *(measured: app-dock-utils.test.ts:4-12)*

## Unwanted
- panelBoundsToContent accepts zero or negative width or height *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent accepts non-finite or non-positive zoom *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent produces content bounds with zero or negative dimensions *(measured: app-dock-utils.test.ts:4-12)*

