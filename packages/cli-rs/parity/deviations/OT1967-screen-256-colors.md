# OT1967: GNU screen gets 256 colors even with `COLORTERM=truecolor`

TypeScript: the TUI uses `@opentui/core` 0.8.1 from npm. Inside GNU screen (`STY`, or a `screen*` `TERM` without
`TMUX`), an inherited `COLORTERM=truecolor` or `24bit` makes it write 24-bit SGR colors (`38;2;r;g;b`). Screen 5
drops these unless its `truecolor` setting is on, so cells lose their color.

Rust: the client pins OpenTUI `c08bb0e90`, which includes anomalyco/opentui#1967. Inside GNU screen, OpenTUI ignores
`COLORTERM` and writes 256-color SGR (`38;5;n`). Set `OPENTUI_FORCE_TRUECOLOR=1` (or `true`) to force 24-bit color,
for example with `setenv OPENTUI_FORCE_TRUECOLOR 1` in `.screenrc` when screen's `truecolor` is on. With
`TERM=screen-256color COLORTERM=truecolor` under a PTY, the Rust home screen writes 200 `38;5`/`48;5` colors and no
`38;2`/`48;2` colors; TS writes 274 `38;2`/`48;2` colors. With `OPENTUI_FORCE_TRUECOLOR=1`, both write 24-bit.

Reason: the OpenTUI fix landed after the npm release that TS uses. The difference goes away when TS moves to an
`@opentui/core` release that includes #1967.
