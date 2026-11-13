# OT2064: the mouse and wheel never leave the prompt cursor inside a mention

TypeScript: `@opentui/core` 0.8.4 applies its extmark rules only to keyboard moves. A wheel step, a click, a
double-click or a drag can leave the prompt's cursor inside an `@file` mention; once the selection is gone, the
next typed character goes into the mention.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2064). When a mouse or wheel operation ends with the
cursor inside atomic marks and no selection, the cursor moves to the marks' outer edge: a wheel step to the edge it
moved toward, a click to the nearer edge, a drag to the side it came from. A key or paste first moves a cursor
still inside a mark to its nearer edge. A press still reports the clicked cell, so clicking a pasted-text label
expands it as in TS.

Reason: TS's behavior is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2064.
