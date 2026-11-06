# V04: reasoning blocks with a Markdown body

TypeScript:

- An open block's body is a `<code filetype="markdown" conceal>` view in `text.muted`
  (`routes/session/message-parts.tsx:102-110`, and `ThoughtEntry` in `routes/session/group-view.tsx:358-403`).

Rust (`crates/tui/src/routes/session/messages/reasoning.rs` and `crates/tui/src/routes/session/grouping.rs`):

- Consecutive reasoning parts form one reasoning group (E.8), whose header counts the steps and adds their
  durations, as in TypeScript. With one part, the `E.6a/transcript` cells match.
- The open body is the Markdown widget with every syntax style in `text.muted`. P-APP has no scenario with an
  open block yet, so how its cells differ from the code view is not measured.

Reason: the Rust `Code` widget has no conceal, so the Markdown widget renders the body.
