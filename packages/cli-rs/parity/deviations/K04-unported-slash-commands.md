# K04: slash commands of unported features

## TypeScript

Typing `/` lists every reachable keymap command with a slash name, its aliases, and the server's commands,
sorted, each padded to the longest name plus two (`packages/tui/src/component/prompt/autocomplete.tsx:491-521`).
The TS TUI registers 38 built-in slash commands.

## Rust

The list, its order, its padding rule, and its fuzzy filter are ported, but only the commands of ported
features are registered. For `/rev` in `E.3/complete`, TS also lists `/undo`, `/web`, `/pair`, and `/btw`,
and its longer names pad every row one column wider.

## Reason

Each command is registered by the step that ports its feature (for example `/undo` with revert, E.10a). The
`slash` checkpoint matches once they land; the `command`, `mention`, and `picked` checkpoints already match in
the prompt and popup rows.
