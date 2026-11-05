# P08: Zed's selection context needs the system SQLite

TypeScript: in a Zed terminal, `editor-zed.ts` reads Zed's workspace database through the SQLite built into
the runtime (`bun:sqlite`, or `node:sqlite` under Node). The context works wherever the TUI runs.

Rust: the TUI loads the system SQLite at run time, the first time it reads the database: `libsqlite3.so.0` on
Linux and `/usr/lib/libsqlite3.dylib` on macOS (`crates/tui/src/prompt/editor_context.rs`, `mod sqlite`). When
the library does not load, every read is "unavailable", as for a database it cannot read: the prompt never
shows a Zed selection, and the TUI polls again every second. Nothing else changes; the binary starts and runs
without the library.

Reason: the bundled SQLite (`rusqlite` with `bundled`) was 6 crates, about 0.8 MB of the binary and the largest
third-party C build of the client. macOS always ships the library, and almost every Linux desktop has it.
Linking the system library at build time instead would make `libsqlite3.so` a start-up
requirement of the whole binary, even without Zed.
