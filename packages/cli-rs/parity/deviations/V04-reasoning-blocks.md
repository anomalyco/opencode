# V04: reasoning blocks with a Markdown body and an unsaved toggle

TypeScript:

- An open block's body is a `<code filetype="markdown" conceal>` view in `text.muted`
  (`routes/session/message-parts.tsx:102-110`, and `ThoughtEntry` in `routes/session/group-view.tsx:358-403`).
- `session.toggle.thinking` writes `session.thinking` to `cli.json`.

Rust (`crates/tui/src/routes/session/messages/reasoning.rs` and `crates/tui/src/routes/session/grouping.rs`):

- Consecutive reasoning parts form one reasoning group (E.8), whose header counts the steps and adds their
  durations, as in TypeScript. With one part, the `E.6a/transcript` cells match.
- The open body is the Markdown widget with every syntax style in `text.muted`. P-APP has no scenario with an
  open block yet, so how its cells differ from the code view is not measured.
- `session.toggle.thinking` switches the mode for the open session view only.

Reason: the Rust `Code` widget has no conceal, so the Markdown widget renders the body. The `cli.json` write
can use `dialogs::settings::update` now; the toggle belongs to E.6a's transcript layer and moves to it with the
next change there.
