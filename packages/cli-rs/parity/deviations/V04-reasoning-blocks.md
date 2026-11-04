# V04: reasoning blocks without grouping, a Markdown body, and an unsaved toggle

TypeScript:

- With `session.thinking: hide`, consecutive reasoning parts form one reasoning group with one header
  (`routes/session/group-view.tsx:162-193`), which counts its steps (`· 3 steps`) and adds their durations.
- An open block's body is a `<code filetype="markdown" conceal>` view in `text.muted`
  (`routes/session/message-parts.tsx:102-110`).
- `session.toggle.thinking` writes `session.thinking` to `cli.json`.

Rust (`crates/tui/src/routes/session/messages/reasoning.rs`):

- Each reasoning part has its own header. In hide mode the header takes the group's colors and two-cell icon, so a
  turn with one reasoning part matches TypeScript cell for cell (`E.6a/transcript`). A turn with several reasoning
  parts shows one header per part.
- The open body is the Markdown widget with every syntax style in `text.muted`. P-APP has no scenario with an
  open block yet, so how its cells differ from the code view is not measured.
- `session.toggle.thinking` switches the mode for the open session view only.

Reason: not built yet. Grouping is E.8's (V06). The `cli.json` write needs a config update API on `Tui`, which
T.1 does not have. An open-block scenario comes with E.8's grouping scenarios.
