# O89: mini writes stderr lines into the scrollback

**TypeScript.** Mini's renderer captures only stdout (`externalOutputMode: "capture-stdout"`,
`runtime.lifecycle.ts:174`). With `opencode mini --print-logs`, each log record goes to stderr as it is and draws
over the split footer: the composer and the status row show the record until the next repaint.

**Rust.** While the footer is up, `crates/mini/src/stderr.rs` puts a pipe on fd 2. Each line written to it becomes a
system row of the scrollback above the footer, and the footer stays intact. When mini ends, stderr is restored
first, then a last line without a newline, or lines that arrive after the app stopped, go to the real stderr. A
panic on the UI thread restores stderr before the panic is printed. Only this process's writes are captured: a
`--standalone` server started before mini keeps the real stderr. A row from stderr is not kept for a resize replay.
Windows keeps stderr as it is.

**Reason.** The user decided to fix the defects the TS client shares in Rust and record them as deviations, with no
upstream proposal (O-89).
