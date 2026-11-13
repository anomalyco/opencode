# OT2064: the mouse does not leave the prompt cursor inside an attachment label

TypeScript: `@opentui/core` 0.8.4 applies its extmark rules only to keyboard moves. A click, a drag or a
double-click that ends inside an `[Image 1]` label leaves the prompt's cursor there, and the next typed character
goes into the label. In `parity/scenarios/OT/extmark-mouse.pty.ts`:

- a click on the label's fourth cell, then `X`: TS reads `a [ImXage 1] b`;
- a drag that ends inside the label: the TS cursor stays at the release cell (column 21);
- a double-click on the label, Right, then `Y`: TS reads `a [Image Y1] b`.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2064). When a mouse operation ends with the cursor
inside a label and no selection, the cursor moves out: after the click to the nearer edge (`a X[Image 1] b`), after
the drag to the side it came from (column 18), and after the double-click and Right to the label's end
(`a [Image 1]Y b`). A press still reports the clicked cell, so a click on a `[Pasted ~N lines]` label expands it as in
TS (`parity/scenarios/E.4/paste-click.pty.ts`, equal on both sides).

Not driven: the wheel. The prompt's wheel steps differ for another reason (`OT2076-wheel-wrapped-row.md`).

Reason: TS's behavior is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2064.
