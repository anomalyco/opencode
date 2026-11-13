# OT2050: Left from a prompt mention stops before the character, not inside it

TypeScript: `@opentui/core` 0.8.4. Left from the end of an `@file` mention (a virtual extmark) moves one display
cell before the mark. After a CJK character, an emoji or a tab that cell is the character's second cell: the cursor
is drawn mid-glyph and the next key goes in front of the character. A word move back into the mark and Up or Down
landing in it nearer its start do the same, and touching or overlapping marks are not skipped together.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2050). The prompt's `Textarea` moves to the mark's
start and takes one Left step, so the cursor lands on the character before the mark; marks that touch or overlap
are skipped together. With ASCII before the mark both clients put the cursor in the same place.

Reason: TS's position is a Core defect, fixed in the same pull request for Core. The difference goes away when TS
moves to an `@opentui/core` release that includes #2050.
