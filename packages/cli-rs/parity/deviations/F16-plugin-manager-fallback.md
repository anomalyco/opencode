# F16: the host lists the plugins while the plugin manager has failed

## TypeScript

The plugin manager is the built-in `opencode.plugins` (`packages/tui/src/feature-plugins/system/plugins.tsx`). It
reaches the plugin registry through the private `usePlugin()` hook, and its `/plugins` command is the only plugin list.
A throw in its dialog is not contained apart from the rest of the TUI, so there is no state in which the manager has
failed and the TUI runs on.

## Rust

The plugin manager is a plugin of contract 2.0 (`crates/tui/src/plugins/manager.rs`), contained as any plugin is: a
panic in one of its calls fails it, and its command and dialogs go. The toasts and the home footer still say "Run
/plugins", so while `opencode.plugins` is listed failed the host registers its own `/plugins`
(`crates/tui/src/plugins/fallback.rs`): a read-only list of the TUI plugins with their status. Enter on a row with an
error, or `view error` (space) on any, the manager's included, shows the error, and the user's enter or click on the
manager's own row, whose footer says "failed, enter enables it again", starts the manager again, after which the
host's list goes; a run of the select by name, as another plugin's `dispatch`, starts nothing. A restart whose setup
fails leaves the manager failed and the list up. A held build of the manager's ID after a crash is not the manager:
the manager that runs keeps `/plugins` and lists that build. A manager disabled by the user (`-opencode.plugins` in the
config) leaves no `/plugins`, as in TS.

## Reason

Synthesis 3.6 and 4.10 (O-125, 3): the manager is a plugin, so it can fail, and the way back to it must not depend on
it. The host keeps the smallest list that names the failures and enables the manager again.
