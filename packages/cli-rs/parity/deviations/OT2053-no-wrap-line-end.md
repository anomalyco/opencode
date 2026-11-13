# OT2053: visual line end works in fields wider than the view

TypeScript: `@opentui/core` 0.8.4's native editor view. In a field that does not wrap, `input.visual.line.end`
(Alt+E) leaves the cursor where it is when the text is wider than the field. In
`parity/scenarios/OT/line-end.pty.ts` the command palette's search field holds 90 characters; after Ctrl+A and
Alt+E, TS types `X` at the start of the text.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2053). Without wrapping the visual line is the logical
line, so Alt+E goes to the end of the text, and `X` lands there. In fields whose text fits, both clients behave the
same.

Reason: TS's behavior is a defect of the shared native editor view. The difference goes away when TS moves to an
`@opentui/core` release that includes #2053.
