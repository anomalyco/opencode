# O89: untrusted text loses its control characters before it reaches the terminal

**TypeScript.** Four kinds of output write model, server or file text to the terminal as it is, outside the renderer:

- the exit epilogue prints the session title (`util/presentation.ts` `epilogue`);
- `run` prints model text, reasoning, tool titles and output, and error messages (`run/noninteractive.ts`);
- the Clack prompts print session titles, integration and model names, form text and auth URLs (`@clack/prompts`);
- `session list`, `stats`, `models`, `auth list`, `mcp list`, the `mini` error line and the error of a failed
  command print titles, names and server messages. Help escapes C0 and DEL in usage errors, not C1.

An escape sequence in that text reaches the terminal. Example: a session titled `x\e]52;c;cHduZWQ=\a` writes
"pwned" to the clipboard (OSC 52) when the TUI exits on it, and a model reply with the same bytes does it during
`opencode run hi`.

**Rust.** `opencode_ui::terminal_text` filters that text first: it removes the escape sequences `ansi-regex`
matches, then every other C0 control except newline and tab, DEL, and C1. The client's own styling is added
after the filter, so it stays. The examples print `xy` and nothing reaches the clipboard. A tool output with color
codes prints without them; a carriage return is dropped, so `\r\n` prints as `\n`. Text without control
characters prints exactly as before, on a terminal and into a pipe. `--format json`, `session export` and
`auth export` are unchanged, as in TS: they are data, their JSON escapes C0 controls, and C1 stays as it is. Help escapes C1 in usage errors as `\xNN`, as
it does C0.

**Reason.** The user decided to fix the defects the TS client shares in Rust and record them as deviations, with no
upstream proposal (O-89).
