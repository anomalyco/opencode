# OT2076: a wheel step keeps the prompt cursor on the wrapped row it lands on

TypeScript: `@opentui/core` 0.8.4's native editor. A wheel step that moves the prompt's cursor onto a wrapped
continuation row puts it on the paragraph's first row, so the next frame scrolls back up to the cursor. In the short
prompt holding one long wrapped paragraph, one wheel step up jumps to the top of the paragraph, and the wheel cannot
show its middle rows.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2076). The wheel moves the cursor as Up and Down do, to
its visual column on the row the view needs, so the wheel scrolls through the wrapped rows. Across unwrapped lines
both clients behave the same.

Reason: TS's behavior is a defect of the shared native editor. The difference goes away when TS moves to an
`@opentui/core` release that includes #2076.
