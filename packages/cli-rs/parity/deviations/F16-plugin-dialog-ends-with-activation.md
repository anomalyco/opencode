# F16: a plugin's dialog ends with its activation

## TypeScript

A plugin's dialogs (`context.ui.dialog.show`, `alert`, `confirm`, `prompt`, `select`) are mounted in the host's
dialog stack, outside the activation's `owned` cleanups (`packages/tui/src/plugin/api.tsx`: `owned` releases the
docked panel, keymap layers and registrations, not dialogs). When the plugin is disabled, fails to reload, or reloads,
its open dialog stays on screen, with focus, and its callbacks belong to the activation that ended.
`packages/tui/test/plugin-keymap.test.tsx` ("a component layer ends with its activation on reload while the
component stays mounted") asserts that the dialog stays across a reload. A throw in a command or a render does not
end a TS activation, so it closes nothing.

## Rust

When an activation of a plugin ends, its dialog closes: on a disable (the plugin manager or `cli.json`), on a reload
that replaces the build, on an unload, at the exit, and when a call of the plugin fails. A panel, a prompt and a list
each belong to the activation that asked for it: `Host::dialog` gets the activation's generation, the TUI records
that owner while the dialog is open, and a dialog or a confirmed action of an activation that is no longer live
(`Registry::live`) shows and runs nothing (`crates/tui/src/plugins/panel.rs`, `show`, `close`, `run`). The registry
calls `Host::revoked` first in the activation's disposal, before the plugin's dispose callbacks, and when it fails the
plugin (`crates/plugin/src/lib.rs`); it closes the dialog only if its owner is that plugin and not live. A dialog
that a dispose callback or a setup that failed asks for never shows. A reload whose new build fails to set up leaves
the running build and its dialog.

The shared fixture shows it: `parity/machines/plugins.json`, rows `dialogA reload` and `dialogB reload`. TS keeps the
prompt (`?/?/?/open`); Rust closes it and shows the plugin on its new build (`A/yes/on/-`).

## Reason

Rich-plugins 4.14 and O-125: "a reload ends every mount of the old build", and when a plugin leaves `active` nothing
it owned is left and focus is at the composer. A dialog's action is a command name, which the host dispatches; left
open after a reload, a prompt or a list of the old build ran the new build's command (the plugin model,
`a-stale-prompt-reaches-no-new-build`, and the P0a review). A dialog of an activation that ended can only call into
code that is gone or into a build that did not open it.
