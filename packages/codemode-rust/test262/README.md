# test262 parity

Runs the reference's pinned test262 file set (`../codemode/test/test262`) with the reference's semantics and
checks the failures against `rust-skipped.txt`.

```sh
bash test262/run.sh                 # what CI runs
bash test262/run.sh built-ins/Array # one directory, by path prefix
bash test262/run.sh --write         # regenerate rust-skipped.txt from the current failures
```

- `run.sh` clones tc39/test262 at the reference manifest's revision into a cache directory (`TEST262_CHECKOUT`),
  then runs the reference's own `script/sync-test262.ts` into `target/test262` (`TEST262_FILES`). The file set and
  its filters are the reference's, unchanged.
- `src/main.rs` runs each file like the reference's `run.ts`: `"use strict"` and the one-line `assert` prelude
  prepended on the same line, the host harness (`$assert` checks, `Test262Error`, `compareArray`, `$DONE`,
  `$DONOTEVALUATE`) from the crate's `test262` feature, a 5 s timeout, negative tests judged by phase, and async
  tests drained and judged by `$DONE`.
- Files in the reference's `skipped.txt` are the reference's own gaps. They run but are not checked.
- `rust-skipped.txt` lists the files that fail here but pass in the reference, each with a reason category. It is
  the parity gap list and may only shrink: CI fails when an unlisted file fails, and when a listed file passes.
