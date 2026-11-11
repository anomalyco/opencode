# OT1998: notification text stays inside its OSC

TypeScript: the TUI uses `@opentui/core` 0.8.4 from npm. Its native notification writer copies the text byte by
byte and drops only C0, DEL and ESC. A C1 control (U+009C is ST in its UTF-8 form) passes through, and OSC 9 text
that starts with a digit reads as a ConEmu subcommand (`9;4;…` is progress). ConEmu, detected by name, gets OSC 9.

Rust: the client pins OpenTUI `ff703d174`, which includes anomalyco/opentui#1998. C0, DEL and C1 controls become
spaces, text that is not UTF-8 sends nothing, OSC 9 text that starts with a digit gets one leading space
(`ESC ] 9 ; ␠2 files: …`), and ConEmu gets no OSC 9 (it shows none for it anyway). The client's `normalize_text`
(`tui/src/features/attention/notify.rs`) already removes control characters and always passes a non-empty title, so
OSC 99 and OSC 777 bytes are the same as TS's, and OSC 9 bytes differ only when the title starts with a digit.

Reason: the OpenTUI fix landed after the npm release that TS uses. The difference goes away when TS moves to an
`@opentui/core` release that includes #1998.
