# W6: JSONL rewrites on Windows compare length and modified time only

**TypeScript.** The TUI rewrites `prompt-history.jsonl`, `prompt-stash.jsonl` and `frecency.jsonl` from memory
and does not check whether the file changed since it was read.

**Rust.** `crates/local/src/jsonl.rs` (`same_file`) replaces a file only when it is still the file that was
read. On Unix that compares device and inode, length and modified time. On Windows it compares length and
modified time only, so a file replaced between the read and the rename by another of the same length and
modified time is overwritten.

**Reason.** The file index that stands in for the inode on Windows (`MetadataExt::file_index`) is unstable in
Rust. The check is stricter than TypeScript's on every platform, and the case it misses needs another writer to
replace the file within one modified-time tick with the same length.
