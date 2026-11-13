# F16: a plugin's terminal title is cleaned and cut to 4091 bytes

## TypeScript

A TUI plugin sets the title with `api.renderer.setTerminalTitle(title)`, OpenTUI's renderer method, and the title
goes to the terminal as the plugin wrote it. Only the client's own titles go through `setTerminalTitle` in
`packages/tui/src/util/renderer.ts`, which replaces each run of control characters with one space.

## Rust

A plugin sets the title with `Host::set_title` (ABI 1.6). The host cleans it as it cleans its own titles
(`opencode_ui::terminal_title`): each run of C0 and C1 control characters becomes one space. It then cuts the title
to 4091 UTF-8 bytes on a character boundary. Example: a plugin title of `"p0b long "` and 3000 `é` (6009 bytes)
sends `"p0b long "` and 2041 `é` (4091 bytes). Scenario: `P.0b/title-long` (P-PTY, Rust only).

## Reason

OpenTUI's Rust session refuses a title longer than 4091 bytes (`ESC ] 0 ; <title> BEL` must fit 4096 bytes,
`session.zig` `title_bytes_max`), and the refusal fails the app's terminal session, which ends the TUI. A plugin
must not be able to end the client with a long string (reviews bigboi-2, carbon-3). A control character in a
title could end the escape sequence early, so plugin titles get the cleaning the client's own titles get.
