# D131: no "Update OpenCode" command

## TypeScript

The CLI always hands the TUI an updater (`packages/cli/src/commands/handlers/default.ts:126-141`), so `app.tsx`
registers `opencode.update` ("Update OpenCode", `/update`, `app.tsx:1062-1072`) and the palette lists it under
System.

## Rust

The TUI registers `opencode.update` only once something sets an update source
(`crates/tui/src/features/update_notification.rs` `set_source`), and the CLI sets none: the palette has no "Update
OpenCode" and `/update` is not a command. The update notice and dialog exist and run under tests.

## Reason

The native client has no updater of its own yet: `opencode-native upgrade` delegates to the TypeScript CLI or, in a
preview build, says to re-run the install script (D01), and the D.2 update flow replaces both. Driven by
`parity/scenarios/D131/palette.pty.ts` (checkpoint `update`, at most two lines; the result row differs in one).
