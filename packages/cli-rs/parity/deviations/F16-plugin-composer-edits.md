# F16: a plugin edits the composer, not the focused editor

## TypeScript

The TUI plugin API has no composer. npm plugins edit it through OpenTUI's `renderer.currentFocusedEditor`
(`insertText`, `setText`), through the composer's internal `ref` (`set`, `submit`), or through the server with
`client.tui.appendPrompt`, which the composer turns into an insert and a move to the end
(`packages/tui/src/component/prompt/index.tsx`, `tui.prompt.append`). `currentFocusedEditor` is whatever editor has
the focus: the composer, or a dialog's input while a dialog is open, and nothing while no editor has it.

## Rust

ABI 1.5 has `Read::composer()` and `Host::edit_composer(ComposerEdit::{Set, Insert, Submit})`. They act on the
composer on screen, on home or in a session, whether or not it has the focus, and never on another editor: with a
dialog open an insert still goes into the composer. Without a composer (a plugin's route) the read is `None` and an
edit does nothing. An insert goes in at the cursor, as `insertText` does; a set is the composer `ref`'s `set`.

## Reason

A plugin cannot reach OpenTUI's renderables (decision O-67), so the edit is an effect on a named target. The
composer is the target the npm plugins mean (the audit's `prompt-edit` class, `investigations/tui-plugin-audit.md`):
voice input, snippets and prompt rewriting. When the composer has the focus, which is when those plugins act, the
result is the same; `parity/scenarios/P.1/p0a-composer.app.ts` checks an insert against TS.
