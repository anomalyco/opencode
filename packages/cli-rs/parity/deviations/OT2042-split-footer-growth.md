# OT2042: mini's footer growth keeps transcript rows in xterm.js terminals

TypeScript: mini uses `@opentui/core` 0.8.4 from npm. When the split footer grows (a multi-line prompt, a permission
prompt, a form), its native renderer makes room with `CSI n S`, wrapped in `ESC 7` / `ESC 8`. Terminals built on
xterm.js, such as VS Code's, discard the rows that scroll out this way, so transcript rows above the footer are lost.

Rust: the client pins OpenTUI `95933781d`, which includes anomalyco/opentui#2042. Growth moves to the last row with
`CSI 65535 H` and writes line feeds there, without `ESC 7` / `ESC 8`, so the top rows go to scrollback in every
terminal. In xterm, kitty, Ghostty, WezTerm and tmux, which already kept the rows, the screen and the scrollback are
the same as TS's: every P-PTY `M.*` scenario and P-TUI scenario passes against the TS recordings. Only the bytes
differ there, and in xterm.js terminals Rust keeps the rows that TS loses.

Reason: the OpenTUI fix landed after the npm release that TS uses. The difference goes away when TS moves to an
`@opentui/core` release that includes #2042.
