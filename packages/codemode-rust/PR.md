# feat: Rust implementation of the PsychoScript language layer

Adds `psychoscript`, a pure-Rust crate (no JavaScript engine at build or run time) that runs and embeds PsychoScript
as a second implementation of the language layer next to `src/language/`: parser (`oxc_parser`), bytecode compiler,
stack VM, standard library, host functions, and snapshots for suspend and resume. Code Mode stays out of scope. The
README maps each `Language` export to its Rust form and describes threading in full.

## Parity

The two implementations stay equally capable both ways: a feature lands in both or neither. Every expectation is
recorded from the TypeScript layer, never written by hand, and CI fails if a regenerated recording differs.

| Recording (generator) | Rust replay | Covers |
|---|---|---|
| `cases/*.json` (`generate.ts`) | `bench/tests/conformance.rs`, also round-trip | 383 programs |
| `host.json` (`host.ts`) | `tests/host_recording.rs` | 53 runs, 11 suspensions |
| `boundary.json` (`boundary.ts`) | `tests/boundary.rs` | 38 programs, 38 configurations, 10 results |
| `streaming.json` (`streaming.ts`) | `tests/streaming.rs` | 693 programs, 59 suspensions |
| test262 (`test262/run.sh`) | both ways | 13444 / 13444 files |

## Threading

- Compiling runs on a thread sized by `nesting::bound` (a conservative nesting bound) only when a program is deeper
  than the 512 KB budget allows.
- Runs stay on the thread that drives them; call depth matches the reference exactly.
- As futures, compute stretches over 1 ms move to the run's own worker; host code is always handed back to the
  executor, in the same order.
- Bench cost stays within 0.5% of single-threaded instruction counts (`bench/RESULTS.md`).

## Known differences

- A saved state resumes only in the implementation and build that saved it (the snapshot formats differ).

## Before merging

Needs the language/Code Mode split in psychoscript, plus the language-layer TypeScript changes this was recorded
against: seven JavaScript-correctness fixes (ToPrimitive conversions, evaluation order of `new` and assignment,
`delete` on primitives, `in` on array holes, built-in details), acorn 8.16, sync-generator parking in
`generators.ts` (its test moves with Code Mode or is rewritten), and the test262 skip-list, `interpreter-support.md`
and `AGENTS.md` updates.
