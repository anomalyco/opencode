# L06: frecency lines without a path or with unusual values

**TypeScript.** `parseFrecency` (`packages/tui/src/prompt/frecency.tsx:12-31`) does not check lines. A JSON line
without a string `path` (for example `5` or `{}`) is kept under the key `undefined`, sorted by a missing
`lastOpen`, and written back on the next load; a `null` line throws, so the TUI loads no frecency at all. Entries
are keyed in a plain object, so a path that reads as an integer (`"1"`) sorts before the others, and the sort
subtracts `lastOpen` values: a string `"5"` counts as 5, `-0` equals `0`, and a missing one makes the order depend on
the engine's sort.

**Rust.** `jsonl::parse_frecency` drops lines without a string `path`. Lines with a string `path` are kept exactly as
written, newest first, as in TypeScript (`jsonl_parsers_match_typescript`), keyed in insertion order and sorted by
numeric `lastOpen` with `f64::total_cmp`, so a missing or non-numeric `lastOpen` sorts first and `-0` after `0`.

**Reason.** Such lines are corruption that no client writes: paths are absolute and `lastOpen` is a timestamp.
Keeping them adds entries that cannot match a file, and a total order keeps Rust's sort from panicking.
