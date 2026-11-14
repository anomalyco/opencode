# M07, M13: `!` shell turns show while `tools` is `hide`

TypeScript: `RunFooter.append` (`packages/tui/src/mini/footer.ts:606`) drops every commit that
`toolTranscript` (`footer.ts:1176-1178`) matches, `kind === "tool"`, while `mini.tools` is `hide`. That is the
default (`verbosity.ts:17-23`). A `!` shell turn's commits are `shellCommit`s, `kind: "tool"`
(`stream-v2.transport.ts:340-353`), so at the default verbosity TS prints neither `$ <command>` nor the output:
the user's own command leaves no row in the scrollback. In `parity/scenarios/M.2/shell-output.pty.ts` with the
default settings, TS shows no shell rows after the turn ends, after 4 s more, or after another key; with
`tools: "show"` it shows them as soon as the turn ends.

Rust: mini prints the `!` shell turn (`$ <command>`, its output, and the exit error) whatever `tools` is.

Reason: the `tools` filter came with the verbosity presets (#47931), which gate model tool calls and skills in
the transport (`showTools()`), and whose "Tools" setting names "files skills activity work steps". Shell turns
are not gated there; they are dropped only by the footer's generic filter. `runShellTurn` even holds the turn
up to 1.5 s "so the output commit renders inside it" (`stream-v2.transport.ts:395-398`). Hiding a command the
user typed is a side effect, not the intent. With `tools: "show"` the two clients print the same rows, so the
scenario sets it and compares the output.
