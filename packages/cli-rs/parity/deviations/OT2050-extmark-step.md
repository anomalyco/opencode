# OT2050: Left from a paste label stops on a character's first cell

TypeScript: `@opentui/core` 0.8.4. Left from the end of a paste label (`[Pasted ~5 lines]`, a virtual extmark)
moves one display cell before the label. After a CJK character that cell is the character's second cell, and the
cursor is drawn there, mid-glyph. In `parity/scenarios/OT/extmark-step.pty.ts` (`a界` then the label) the TS cursor
is at column 18, on the second cell of `界`.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2050). The prompt's `Textarea` moves to the label's
start and takes one Left step, so the cursor is on the first cell of `界`, column 17.

A key typed there goes in front of `界` on both sides (`aX界[Pasted ~5 lines]`). Labels made by pasting are never
adjacent (each paste adds a space after its label), so the PR's touching-marks case does not occur in the prompt.

Reason: TS's position is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2050.
