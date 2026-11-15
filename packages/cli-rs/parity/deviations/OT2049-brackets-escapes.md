# OT2049: brackets and backslash escapes follow CommonMark

TypeScript: on `@opentui/core` 0.8.4 the TUI draws a paragraph from its raw source through the tree-sitter Markdown
highlighter (OT2049-link-reference-definitions). Two things follow:

- A bracketed label with no link reference definition, such as `[shell] hello`, is highlighted as a shortcut
  reference link: conceal hides the brackets, and `shell` takes the link style (cyan, underlined).
- A backslash escape such as `\"` keeps its backslash; the escape is highlighted but not concealed, so
  `tool \"prune\"` shows `tool \"prune\"`.

Rust: the client's `Markdown` widget runs on OpenTUI's native engine (OT2049), which follows CommonMark: a label
with no matching definition is not a link and shows as text, brackets included (`[shell] hello`), and a backslash
before ASCII punctuation is an escape that shows only the character (`tool "prune"`).

Driven against TS: `parity/scenarios/OT/brackets-escapes.sim.ts` (P-TUI). A reply has `[shell] hello-again` and
`Invalid arguments for tool \"prune\".`; at the `done` checkpoint the first row differs in 18 cells (the brackets
and the link style) and the second in 10 (the two backslashes and the text they move). The field test saw the same
in tool results a mock model echoed (`steps/plugins-field-test.md`, "Not plugin defects").

Reason: CommonMark 0.31.2 says a shortcut reference link needs a matching link reference definition (section 6.3)
and that a backslash before ASCII punctuation is a literal character (section 2.4). TS keeps the 0.8.4 highlighter
path because `TextPart` asks for nothing else, not by choice. Core's newer releases render through the same engine
as Rust (OT2049-markdown-engine), so the difference should go away when TS moves to one of them.
