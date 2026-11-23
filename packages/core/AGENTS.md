## SQLite

- On macOS, `bun:sqlite` loads the system `libsqlite3.dylib`. Only Linux and Windows use the SQLite built into Bun, so on a Mac the SQLite version follows the OS, not the Bun we ship: 3.39.4 on macOS 13.0, 3.39.5 from 13.1 to 14.1, 3.43.2 from 14.2 through macOS 15.
- Never use SQL newer than SQLite 3.39.4. macOS 13.0 is the oldest macOS Bun supports. Check the version that added a function or syntax before using it: `concat()` and `string_agg()` are 3.44, and the `jsonb` functions are 3.45.
- macOS 12 is outside Bun's support but still runs OpenCode, on SQLite 3.36.0 (12.0 to 12.2) or 3.37.0. Keep it working where that costs nothing: avoid the `->` and `->>` operators and `unixepoch()`, all added in 3.38.
- `json_extract(column, '$.path')` replaces `->` only for an array or object. For a scalar it returns the SQL value, as `->>` does, so `json()` around it fails on a JSON string, and a JSON `null` becomes SQL `NULL`, the same as a missing key. Use `json_type` when that difference matters.
- Unit tests don't catch this: they run on Linux and Windows only, where the bundled SQLite is current. v2.4.0 broke every session on macOS 12 this way (https://github.com/anomalyco/opencode/issues/65764).
