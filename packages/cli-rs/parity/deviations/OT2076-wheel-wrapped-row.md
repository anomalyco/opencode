# OT2076: the wheel scrolls through a long wrapped prompt

TypeScript: `@opentui/core` 0.8.4's native editor. In `parity/scenarios/OT/wheel-wrapped.pty.ts` the prompt holds
one paragraph of 160 words that wraps past its height, with the cursor at the end. Three wheel steps up over it
change nothing in TS: the view still shows the last rows, the cursor stays after `w159`, and a typed `Q` goes
there. (#2076 traces this to the wheel's cursor move: on a wrapped paragraph it keeps only the logical line, and
the next frame scrolls back to the cursor.)

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2076). The wheel moves the cursor as Up does, to its
column on the row the view needs, so the view scrolls one row per step up to the paragraph's first row, and the
cursor moves with it: `Q` lands mid-paragraph (`w103Q`). Across lines that do not wrap, both clients behave the
same. The previous Rust pin behaved as TS here.

Reason: TS's behavior is a defect of the shared native editor. The difference goes away when TS moves to an
`@opentui/core` release that includes #2076.
