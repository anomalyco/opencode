# F15: Ctrl+C in the diff viewer is the host's

## TypeScript

The diff viewer's keymap layer (`packages/tui/src/feature-plugins/system/diff-viewer.tsx`) binds `app.exit` to
"Close diff viewer", so while the viewer has the input every key of `app.exit` closes it: `ctrl+c`, `ctrl+d` (unless
`diff.half_page.down` takes it first) and `<leader>q`.

## Rust

The viewer is a plugin of contract 2.0 (`crates/tui/src/plugins/diffs`, phase P6c). Its layer binds `app.exit` by name
too (`Bind::command`), so `ctrl+d` and `<leader>q` close it as in TS. `ctrl+c` is no plugin's key (synthesis 3.8,
O-138): before any layer sees it, it ends every plugin mode and goes on to the host in the base mode, where it is the
host's `app.exit`. In the viewer it therefore exits the app, as it does on home with an empty composer, instead of
closing the viewer. `escape` and `q` close the viewer, as in TS.

## Reason

The reserved chord is the user's way out of any plugin, and no plugin may take it, the built-ins included: an exception
for the viewer would make it something other than a plugin of the one API. A host rule that ends a plugin's own
surface on the chord instead of exiting is possible, and is left to a decision.
