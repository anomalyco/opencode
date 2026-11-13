# OT2053: visual line end works in fields wider than the view

TypeScript: `@opentui/core` 0.8.4's native editor view. In a field that does not wrap (every single-line input,
such as a dialog's search field), `input.visual.line.end` (Alt+E) and `input.select.visual.line.end` (Alt+Shift+E)
leave the cursor where it is when the text is wider than the field. Ctrl+E works.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2053). Without wrapping the visual line is the logical
line, so these commands go to (or select to) the end of the text, as Ctrl+E does. In wrapping fields, such as the
prompt, and in fields whose text fits, both clients behave the same.

Reason: TS's behavior is a defect of the shared native editor view. The difference goes away when TS moves to an
`@opentui/core` release that includes #2053.
