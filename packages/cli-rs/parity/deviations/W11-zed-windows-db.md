# W11: Zed's database on Windows

TypeScript: `resolveZedDbPath` (`editor-zed.ts`) tries `OPENCODE_ZED_DB`, then
`~/Library/Application Support/Zed/db/0-stable/db.sqlite` and `~/.local/share/zed/db/0-stable/db.sqlite`. Zed on
Windows keeps its database in neither, so a Zed terminal on Windows shows no selection context unless
`OPENCODE_ZED_DB` is set.

Rust: on Windows the candidates end with `%LOCALAPPDATA%\Zed\db\0-stable\db.sqlite`, Zed's own path there
(`crates/tui/src/prompt/editor_context.rs`, `zed_db_candidates`). The database is read through `winsqlite3.dll`
from System32 (see P08). Other platforms are unchanged.

Reason: the TS list misses Zed's Windows path; adding it gives Windows the context the other platforms have, and
an explicit `OPENCODE_ZED_DB` still wins.
