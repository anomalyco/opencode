# OT2050: Left from a paste label stops on a character's first cell

TypeScript: `@opentui/core` 0.8.4. Left from the end of a paste label (`[Pasted ~5 lines]`, a virtual extmark)
moves one display cell before the label. After a CJK character that cell is the character's second cell, and the
cursor is drawn there, mid-glyph. In `parity/scenarios/OT/extmark-step.pty.ts` (`a界` then the label) the TS cursor
is at column 18, on the second cell of `界`.

Rust: the client pins OpenTUI `32e9e414e`. Left from a label's end goes to the start of the character before the label
(anomalyco/opentui#2050), and since #2104 native code applies that rule. The cursor is on the first cell of `界`, column
17, as before #2104.

A key typed there goes in front of `界` on both sides (`aX界[Pasted ~5 lines]`). Labels that touch step differently
too; `OT2104-chip-steps.md` covers them.

Reason: TS's position is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2050.
