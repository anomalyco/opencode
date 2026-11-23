## SQLite

- On macOS, `bun:sqlite` loads the system `libsqlite3.dylib`. Only Linux and Windows use the SQLite built into Bun, so on a Mac the SQLite version follows the OS, not the Bun we ship: 3.37.0 on macOS 12, 3.39.4 on macOS 13, 3.43.2 on macOS 14 and 15.
- Write SQL that SQLite 3.37 can run. Use `json_extract(column, '$.path')` instead of the `->` and `->>` operators (3.38), and check the version that added any other function or syntax before using it: `unixepoch()` is 3.38, `concat()` and `string_agg()` are 3.44, and the `jsonb` functions are 3.45.
- CI can't catch this. Unit tests run on Linux and Windows only, where the bundled SQLite is current. v2.4.0 broke every session on macOS 12 this way (https://github.com/anomalyco/opencode/issues/65764).
