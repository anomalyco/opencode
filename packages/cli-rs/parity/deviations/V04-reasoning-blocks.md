# V04: reasoning blocks in source mode

TypeScript (`ReasoningBody` in `routes/session/message-parts.tsx`, used by `ReasoningPart` and by `ThoughtEntry` in
`routes/session/group-view.tsx`):

- Rendered mode (the default) draws an open block's body with Core's `<markdown>` in the reasoning colors, as an
  answer is drawn (since #63989).
- Source mode (`session.markdown: "source"`) keeps a `<code filetype="markdown">` view of the source, highlighted in
  `text.muted`, with nothing concealed.

Rust (`crates/tui/src/routes/session/messages/reasoning.rs` and `crates/tui/src/routes/session/grouping.rs`):

- Consecutive reasoning parts form one reasoning group (E.8), whose header counts the steps and adds their
  durations, as in TypeScript.
- The open body is the Markdown widget in both modes, with every syntax style in `text.muted`. In rendered mode it
  matches TypeScript cell for cell (`E.6a/reasoning-open`: emphasis, code spans, a list and a table). In source mode it
  is the Markdown widget with conceal off, not a code view; P-APP has no source-mode scenario, so how its cells differ
  is not measured.

Reason: the Rust `Code` widget has no Markdown view of its own, so the Markdown widget with conceal off shows the
source.
