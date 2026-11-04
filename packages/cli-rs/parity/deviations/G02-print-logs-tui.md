# G02: `--print-logs` while the full-screen TUI runs

TypeScript: the stderr logger (`packages/util/src/observability/logging.ts`) writes every record with
`process.stderr.write`. OpenTUI's renderer runs with `externalOutputMode: "passthrough"` and does not capture
stderr, so while the TUI is on the alternate screen the records draw over it. A 110x32 PTY run of
`opencode --print-logs` with `OPENCODE_LOG_LEVEL=DEBUG` showed 137 records written inside the alternate screen,
and none after it. They stay on the screen until the next redraw of those cells and are not in the scrollback.

Rust: `opencode_tui::run` sets `AppOptions::capture_stderr`. While the TUI runs, whatever the process writes to
stderr (log records, stray `eprintln!`) goes to the opentui console, and is written to the real stderr after
the terminal is restored. The same PTY run, with a record written to the process's stderr during the TUI, shows
no record on the screen and the record after the alternate screen is left:

```
log records inside the TUI: 0
log records after the TUI: 1
after: …[?1049l…timestamp=probe level=INFO message="written during the TUI"
```

Reason: records drawn over the screen corrupt the UI and are lost when the alternate screen closes. Capturing
them keeps the screen intact and keeps every record. The log file gets every record in both clients.
