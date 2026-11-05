# K04: `/restart` is not offered

## TypeScript

Typing `/` lists every reachable keymap command with a slash name, its aliases, and the server's commands,
sorted, each padded to the longest name plus two (`packages/tui/src/component/prompt/autocomplete.tsx:491-521`).
With a managed background service, `service.restart` adds `/restart` (`packages/tui/src/app.tsx:1083-1098`).

## Rust

The list, its order, its padding rule, its fuzzy filter, and every built-in slash command but `/restart` are
ported; `E.3/complete` matches TS at every checkpoint. `service.restart` is not registered
(`crates/tui/src/features/system_commands.rs`), so `/restart` never shows, even with a managed service.

## Reason

Restarting stops the shared background service, which this client never does (orchestrator decision O-21).
`opencode-rs service restart` restarts it as an explicit command (O-39).
