# O89: a failed stash save shows a toast

**TypeScript.** `push` writes the stash entry with `appendText(...).catch(() => {})`
(`packages/tui/src/prompt/stash.tsx:54-72`). A write that fails (a full disk, a read-only state directory) is
ignored; the prompt is cleared and the draft lives only in memory until the TUI exits.

**Rust.** `prompt.stash` logs the error and shows an error toast, "Could not save the stash: <error>". The prompt is
still cleared and the entry stays in the in-memory stash, so `prompt.stash.pop` or the stash list brings it back
while the TUI runs. A failed pop or remove is only logged, as before.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.
