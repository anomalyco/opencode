# L06: frecency lines without a path

**TypeScript.** `parseFrecency` (`packages/tui/src/prompt/frecency.tsx:12-31`) does not check lines. A JSON line
without a string `path` (for example `5` or `{}`) is kept under the key `undefined`, sorted by a missing
`lastOpen`, and written back on the next load.

**Rust.** `jsonl::parse_frecency` drops such lines. Lines with a string `path` are kept exactly as written,
newest first, as in TypeScript (`jsonl_parsers_match_typescript`).

**Reason.** Such a line is corruption that no client writes; keeping it adds an entry that cannot match a file.
