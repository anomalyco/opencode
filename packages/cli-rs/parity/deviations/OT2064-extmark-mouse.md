# OT2064: the mouse does not leave the prompt cursor inside an attachment label

TypeScript: `@opentui/core` 0.8.4 applies its extmark rules only to keyboard moves. A click, a drag, a
double-click or a wheel step that ends inside an `[Image 1]` label leaves the prompt's cursor there, and the next
typed character goes into the label. In `parity/scenarios/OT/extmark-mouse.pty.ts`:

- a click on the label's fourth cell, then `X`: TS reads `a [ImXage 1] b`;
- a drag that ends inside the label: the TS cursor stays at the release cell (column 21);
- a double-click on the label, Right, then `Y`: TS reads `a [Image Y1] b`.

In `parity/scenarios/OT/extmark-wheel.pty.ts` the prompt holds short lines that do not wrap, with the cursor at
text column 8, and one line `top [Image 1] end` whose label spans that column. Each wheel step up moves the cursor
up one line; the step that reaches the label line leaves the TS cursor inside the label (screen column 24), and
`X` reads `top [ImaXge 1] end`.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2064). When a mouse operation ends with the cursor
inside a label and no selection, the cursor moves out: after the click to the nearer edge (`a X[Image 1] b`), after
the drag to the side it came from (column 18), after the double-click and Right to the label's end
(`a [Image 1]Y b`), and after the wheel step to the label's start (screen column 20, `top X[Image 1] end`). Later
wheel steps keep that column, so on the lines above the cursor sits at text column 4, where TS keeps column 8
(seen once, 24 steps). A press still reports the clicked cell, so a click on a `[Pasted ~N lines]` label expands it
as in TS (`parity/scenarios/E.4/paste-click.pty.ts`, equal on both sides).

Reason: TS's behavior is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2064.
