# K04: `/restart` and `/find` are not offered

## TypeScript

Typing `/` lists every reachable keymap command with a slash name, its aliases, and the server's commands,
sorted, each padded to the longest name plus two (`packages/tui/src/component/prompt/autocomplete.tsx:491-521`).
With a managed background service, `service.restart` adds `/restart` (`packages/tui/src/app.tsx:1083-1098`).
With the `session-find` experiment on, `session.find` adds `/find`, which opens a find bar over the session
(`packages/tui/src/routes/session/index.tsx`, `packages/tui/src/routes/session/find.ts`).

## Rust

The list, its order, its padding rule, its fuzzy filter, and every built-in slash command but `/restart` and
`/find` are ported; `E.3/complete` matches TS at every checkpoint. `service.restart` is not registered
(`crates/tui/src/features/system_commands.rs`), so `/restart` never shows, even with a managed service.
`session.find` is not registered and the `session-find` experiment is not offered, so `/find` never shows.

## Reason

Restarting stops the shared background service, which this client never does.
`opencode-native service restart` restarts it as an explicit command.

Find in session is a new experimental feature with its own view and search state; it is not ported yet.
