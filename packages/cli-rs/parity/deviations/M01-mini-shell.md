# M01, M03, M11, M15: mini shell differences

## Markdown after a resize replay (TypeScript defect)

After a resize, TS `mini` writes assistant Markdown at the wrong column: at 34 columns, `Second answer:` comes out
as `Sec` / `ond answer:`, and `Third answer, the last one.` wraps after `the` although it fits. Prompts, errors,
and the entry header are right. The Rust client wraps them at the new width. `parity/scenarios/M.1/resize.pty.ts`
therefore replays a plain-text history (prompts and errors), which both clients write cell for cell. Seen with
`resize.pty.ts` at 24 and 34 columns over the Markdown history of `fixture.ts`.

## Streaming Markdown commits complete blocks

Core commits a streaming Markdown entry block by block from the renderable's block positions. opentui-rust's
Markdown widget does not expose them, so the Rust writer renders the text before the last blank line outside a
fence and commits those rows (`scrollback::stable_prefix`). A finished entry is the same; while it streams, a
paragraph shows once it is followed by a blank line or the entry ends.

## Reasoning is drawn by the Markdown widget

As in the TUI (`V04-reasoning-blocks.md`): TS draws reasoning with `<code filetype="markdown">`, whose conceal
hides `_Thinking:_`'s markers. opentui-rust's `Code` has no conceal, so the Markdown widget draws it in the
reasoning color.

## SIGINT and SIGUSR2

- TS turns an external SIGINT into the two-press exit. In the Rust client the renderer owns SIGINT and ends the
  app; mini then closes as on any exit (writes what is queued, leaves split mode, prints the newline). Ctrl+C in
  the terminal is a key and keeps the two-press exit.
- SIGUSR2 resolves the theme again (custom theme files and `cli.json`'s theme as read at start) against the
  palette the terminal reported at start. TS asks the terminal for its palette again; opentui-rust cannot query
  the terminal while the app runs.

## Scrollback colors

Scrollback colors are quantized to the nearest palette slot as in TS. The slot's fallback snapshot is xterm's
color for that slot, not the color the terminal reported; terminals with a palette draw their own color either
way.
