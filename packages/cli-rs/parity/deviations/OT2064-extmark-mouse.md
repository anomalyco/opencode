# OT2064: when the mouse moves the prompt cursor out of an attachment label

TypeScript (`@opentui/core` 0.9.4, since #63989, which includes anomalyco/opentui#2064): a click, a drag, a
double-click or a wheel step that ends inside an `[Image 1]` label moves the cursor out, as Rust does: the click to
the nearer edge, the drag to the side it came from, the double-click and Right to the label's end, the wheel step to
the label's start. Core already moves the cursor on the press: in `parity/scenarios/OT/extmark-mouse.pty.ts` the
cursor is at column 18 while the button is still down.

Rust (OpenTUI 0.9.4's Rust crates): the press reports the clicked cell and leaves the cursor there (column 21); the
release moves it out, as in TS. A click on a `[Pasted ~N lines]` label expands it as in TS
(`parity/scenarios/E.4/paste-click.pty.ts`).

Reason: the textarea's mouse handling is OpenTUI's; the cursor ends in the same place after the release in both, and
only the frame between press and release differs (the `pressed` checkpoint's cursor, 1 line). It goes away when the
Rust crates move the cursor on the press as Core does.
