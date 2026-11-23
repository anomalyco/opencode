# DW6: the external editor's file is quoted on Windows

TypeScript: `openEditor` (`packages/tui/src/editor.ts`) spawns the editor with `shell: true` on Windows, so Node runs
`cmd.exe /d /s /c "<editor> <file>"` with the temp file unquoted. A temp directory with a space (for example a user
name with a space under `%TEMP%`) splits the path, and the editor opens the wrong file or none; a `&` or `^` in the
path is parsed by cmd.

Rust: the same `cmd.exe /d /s /c` command line (`%ComSpec%`, else `cmd.exe`, as Node), with the file in double
quotes: `cmd.exe /d /s /c "<editor> "<file>""`. The editor string still reaches cmd as written, so `code --wait` and
a quoted editor path work as in TS. cmd still expands a defined `%VAR%` in the path, as it does for TS. Unix runs the
editor without a shell, as TS does.

Reason: decision DW6 of the Windows port plan. The quotes only make paths work that TS breaks on.
