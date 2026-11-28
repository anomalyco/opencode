# E.14: the session sidebar only opens on the right

## TypeScript

`session.sidebar_position: "left"` in `cli.json` puts both the docked session sidebar and its narrow overlay on the left.
The default is `"right"`. The Settings dialog and command palette list **Sidebar position**.

## Rust

`opencode-native` ignores `session.sidebar_position`, keeps the sidebar on the right in both layouts, and omits
**Sidebar position** from the Settings dialog and command palette.

## Reason

The position setting is currently implemented only in the TypeScript TUI. The E.18a settings oracle and dialog
recordings and the E.20/toggles app recording omit this row when comparing the two clients.
