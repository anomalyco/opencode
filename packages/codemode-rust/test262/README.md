# test262 parity

Runs the reference's pinned test262 file set (`../codemode/test/test262`) with the reference's semantics and
checks the failures against `rust-skipped.txt`.

```sh
bash test262/run.sh                 # what CI runs
bash test262/run.sh built-ins/Array # one directory, by path prefix
bash test262/run.sh --write         # regenerate both gap lists from the current outcomes
```

- `run.sh` clones tc39/test262 at the reference manifest's revision into a cache directory (`TEST262_CHECKOUT`),
  then runs the reference's own `script/sync-test262.ts` into `target/test262` (`TEST262_FILES`). The file set and
  its filters are the reference's, unchanged.
- `src/main.rs` runs each file like the reference's `run.ts`: `"use strict"` and the one-line `assert` prelude
  prepended on the same line, the host harness (`$assert` checks, `Test262Error`, `compareArray`, `$DONE`,
  `$DONOTEVALUATE`) from the crate's `test262` feature, a 5 s timeout, negative tests judged by phase, and async
  tests drained and judged by `$DONE`.
- Parity runs both ways, with one list per direction. Both may only shrink.
  - `rust-skipped.txt` lists the files that fail here but pass in the reference, each with a reason category. CI
    fails when an unlisted file fails, and when a listed file passes.
  - `reference-gaps.txt` lists the files in the reference's `skipped.txt` that pass here: gaps on the TypeScript
    side. Each category starts with `real` (Rust has the behaviour, TypeScript lacks it) or `accident` (Rust passes
    through a looser check where the reference is deliberately strict; Rust should match the reference). CI fails
    when an unlisted file passes, when a listed file fails here or leaves the reference's `skipped.txt`, and when
    `reference.ts`, which runs the listed files through the reference's own `run.ts`, sees one pass.
- `--write` regenerates both lists. It keeps the categories already in `reference-gaps.txt` and marks new entries
  `uncategorised`, with the reference's reason, for a person to judge.
