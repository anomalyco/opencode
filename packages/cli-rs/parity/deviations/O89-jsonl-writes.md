# O89: the shared stash, history, and frecency files lose as little as Rust alone can

**TypeScript.** `prompt-stash.jsonl`, `prompt-history.jsonl`, and `frecency.jsonl` are written without a lock
(`packages/tui/src/util/persistence.ts:12-20`). `push` appends, but `pop`, `remove`, and a trimmed `push` overwrite
the file from the list in memory (`packages/tui/src/prompt/stash.tsx:54-90`, `history.tsx:121-143`), so they drop
every line another client appended since the load.

**Rust.** Every write takes the `<state>/locks` file-key lock and works from the file, never from memory. Saves
only append. A stash pop or remove, and the trim on load, reread the file, drop or keep lines, write the new text
to a temporary file, sync it, and rename it over the file only when the file is still the one read (same inode,
size, and modification time). Otherwise they read again and redo the change, up to five times, then give up with
a logged error and leave the file as it is. The file is never truncated in place. Lines appended to the old file
after the rename check are carried over from its open handle to the end of the new file.

**Remaining risk.** TypeScript still writes without the lock, so Rust cannot make the files fully safe:

- A TypeScript append that opened the old file before the rename and writes after Rust has read its late lines is
  lost. The window is the time between Rust's last read of the old file and the TypeScript write.
- A TypeScript rewrite (its `pop`, `remove`, or trim) that lands between Rust's check and its rename is replaced
  by the Rust text.
- A TypeScript rewrite from memory drops lines Rust appended since TypeScript loaded the file, as it drops its own
  other clients' lines today.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations, with no
upstream proposal (the TypeScript lock is not added).
