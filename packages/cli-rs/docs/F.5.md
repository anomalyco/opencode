# F.5 config files: design

F.5 reads and writes the client-local files the TypeScript TUI shares (user Q14 a): `cli.json`, the TUI
storage keys, the JSONL files, and `model.json`. Both clients use the same paths, the same `Flock` lock
(F.4 `lock.rs`), and the same atomic writes, so they can run side by side. This note covers JSONC editing,
which is the part that must keep a user's comments and formatting byte for byte.

## JSONC editing

`Config.update` (`packages/cli/src/config/config.ts:83-110`) does this:

1. Diff the decoded config before and after the change (`changes`, `:151-168`). The diff gives a list of
   `(path, value | undefined)` edits.
2. For each edit, call `jsonc-parser`'s `modify(text, path, value, { formattingOptions: { tabSize: 2,
   insertSpaces: true } })` and apply the returned edits.
3. Parse the result again. On a parse error or a schema failure, the update fails with "Invalid CLI config
   update".

The migration (`packages/cli/src/config/migrate.ts`) uses `modify`, `parseTree`, and `createScanner` too.

`crates/local/src/jsonc.rs` is a line-by-line port of the parts of `jsonc-parser` 3.3.1 that these callers
use (`node_modules/.bun/jsonc-parser@3.3.1/.../lib/esm/impl`):

- `Scanner`: `scanner.js`, token for token, including trivia, comments, and scan errors. Offsets are UTF-8
  byte offsets, not UTF-16 units. That is safe, because every split point is a token boundary and the
  formatter only counts ASCII spaces, tabs, and line breaks.
- `parse_tree`: `parser.js` `visit` + `parseTree`, with `allowTrailingComma`. It gives the node tree
  (object, array, property, string, number, boolean, null; offset, length, children, `colonOffset`) and the
  errors. `parse` builds a `serde_json::Value` (with `preserve_order`, so key order is JS insertion order,
  and a duplicate key keeps its first position with the last value, as a JS object does).
- `set_property` (`edit.js`) and `format` (`format.js` with `keepLines: false`), joined into `modify`. They
  give the same single edit as `withFormatting`.
- `stringify`: `JSON.stringify` for values, including the JS number format (`1` not `1.0`, `1e+21`,
  `1e-7`).

The port does not use the `jsonc-parser` crate from the workspace dependencies. Its CST edits format
differently from the JS library, and byte-equal output is the bar.

Proof: P-ORACLE. `parity/oracle/F.5-config.ts jsonc` runs the real `modify` + `applyEdits` over a corpus of
texts (comments in every position, trailing commas, CRLF, tabs, empty objects, nested inserts, removals of
first, middle, and last properties, array values) and edit paths. The Rust test applies the same edits and
compares bytes.

## Files and APIs

| File | TS | Rust |
| --- | --- | --- |
| `cli.json` | `packages/cli/src/config/config.ts` | `cli_config::CliConfig` |
| V1 migration | `packages/cli/src/config/migrate.ts` | `migrate::run`, `migrate::migrate_v1` |
| storage | `packages/tui/src/context/storage.tsx` | `storage::Storage` |
| JSONL | `prompt/history.tsx`, `prompt/stash.tsx`, `prompt/frecency.tsx` | `jsonl::{History, Stash, Frecency}` |
| `model.json` | `packages/tui/src/model-preference.ts` | `model_pref::ModelPreferences` |
| watches | `packages/tui/src/util/watch.ts` and the callers' debounce | `watch::watch` |

### `cli.json`

- `Config::info` is the decoded `Info` (`packages/cli/src/config/schema.ts:6-9` plus `config/index.tsx:69-259`)
  as plain serde structs. Decoding is as strict as Effect Schema: a wrong type, a `null`, or a value out of
  range anywhere fails the whole document, which then reads as `{}`. Unknown keys are dropped, as Effect's
  `Struct` does.
- `Resolved` (`config/index.tsx:291-340`) adds the defaults. It gives U.2 the `keybinds` object (passed to
  `Keybinds::resolve` unchanged; that function applies the Windows rules) and `leader.timeout`.
- `CliConfig::get()` runs the migration and loads under the lock. `CliConfig::update(|info| ...)` changes a
  typed `Info`; the diff runs on the JSON values of before and after, in schema field order, then edits the
  file text as above. U.1's `ThemeState` effects (`PersistName`, `PersistMode`) become
  `update(|c| c.theme...)`.
- `OPENCODE_CLI_CONFIG_CONTENT` is decoded once and merged over the file on every read, as in TS.
- The lock is `lock::acquire(<state>/locks, <config>/cli.json)` (`config.ts:57`).

### Storage, JSONL, `model.json`

- Storage: `<state>/<storage channel>/tui/<key>.json`, lock directory `<state>/<channel>/locks`, key the file
  path. Values are JSON objects or arrays; a missing or broken file reads as the initial value. Writes are
  compact `JSON.stringify` to `<file>.<pid>.<uuid>.tmp` and a rename. The API works on `serde_json::Value`
  so that fields the other client wrote survive a write.
- JSONL: the load, self-heal rewrite, limit, append, and trim rules of the three TS providers. History and
  stash entries stay `serde_json::Value`, for the same reason.
- `model.json`: `decodeModelPreference`, `addRecent`, `setFavorite`, `saveVariant`, under the lock
  `<state>/locks` with key the file path.

### Watches

`watch::watch(dir, filter, debounce, callback)` is one `notify` watcher on one directory, with one debounce
thread. Each caller makes one: `cli.json` watches the config directory, storage watches its `tui`
directory, and `model.json` watches the state directory with a name filter (the TS filter: the name itself
or `<name>.*`). `OPENCODE_FILEWATCHER_DISABLE` or `OPENCODE_DISABLE_FILEWATCHER` set to `1` or `true` turns
every watch off (`util/watch.ts:11`). A watch that fails to start returns `None`, so live reload is lost but
nothing else.

TS reloads `cli.json` on every event without a debounce; Rust uses the same 50 ms debounce as storage, so a
temp-file-and-rename write gives one reload. That is not a visible difference.

## Generated data

`script/gen/config.ts` writes `crates/local/src/generated/config.rs`: the 244 current keybind names (for
decoding `keybinds` and for the migration), the V1 keybind names, and the V1 `CommandMap`. The serde
structs are written by hand; the oracle proves them against the TS decoder.
