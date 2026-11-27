# E.14: the session sidebar only opens on the right

## TypeScript

`session.sidebar_position: "left"` in `cli.json` puts both the docked session sidebar and its narrow overlay on the left.
The default is `"right"`.

## Rust

`opencode-native` ignores `session.sidebar_position` and keeps the sidebar on the right in both layouts.

## Reason

The position setting is currently implemented only in the TypeScript TUI.
