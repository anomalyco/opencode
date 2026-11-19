# feat: Rust implementation of the PsychoScript language layer

## Summary

This adds `psychoscript`, a Rust crate that runs and embeds the PsychoScript language, as a second implementation
of the language layer next to the TypeScript one (`src/language/`). It is pure Rust, with no Bun, Node or other
JavaScript engine at build or run time: a parser (`oxc_parser`), a bytecode compiler, a stack VM, the standard
library, promises and async iteration, host functions and their crossing, and snapshots for suspend and resume.

The crate covers the language layer only. Code Mode (tools, schemas, the catalog, `search`, OpenAPI, hooks,
`maxToolCalls`) stays a layer on top of the language, as it is in TypeScript; a Rust host builds its own layer from
host functions.

## The API

The public API is the Rust form of the `Language` namespace (`src/language/index.ts`); `README.md` maps each
reference export to its Rust counterpart.

- `Runtime::make()` with `.globals(|run| ...)`, `.modules(..)`, `.limits(..)` and `.translate(..)`.
- `HostFunction`, the counterpart of `Host.fn`:
  - sync by default; `new_async` for async; `.thenable()` for sync-thenable;
  - `.idempotent()`, `.constructible()`, `.takes_functions()` and `.snapshot(encode, decode)`;
  - a sync function returns its value now, or work that stays pending (`Returned::Pending`, the reference's
    Promise), or work the program waits for (`Returned::Block`, the reference's Effect).
- `DurableFunction` (`Host.durableFn`), `Namespace` (`Host.namespace`), `Failure` (`Host.fail`, `Host.missing`).
- `HostValue`, the values that cross, with `HostString` for strings: it keeps an unpaired surrogate, so a host sees
  and returns exactly what the program had, and converts to a Rust `String` lossily only when asked.
- `Run`, with its id and metadata.
- `execute`, `execute_with` and `execute_async`; `program`; `Program::run`, `run_resumable` and `run_async`;
  `Suspender::suspend`; `resume` and `resume_bytes`.
- `to_bytes`, `from_bytes`, `SnapshotError`, `SuspendError`, `StreamingResponse`, `global_names()`, `Diagnostic`,
  `DiagnosticKind` and `Json`.

Host work is a `Future` instead of an Effect. `execute` drives a run on the calling thread; `execute_async` and
`run_async` run on any executor.

## Parity, and how it is checked

The two implementations must stay equally capable in both directions: a feature lands in both or in neither.
Every expectation is recorded from the TypeScript language layer, never written by hand. CI regenerates the
recordings and fails on any difference.

| Recording | Generator | Rust replay | Size |
|---|---|---|---|
| `conformance/cases/*.json` | `generate.ts` | `bench/tests/conformance.rs` (also in round-trip mode) | 383 programs |
| `conformance/host.json` | `host.ts` | `tests/host_recording.rs` | 53 runs, 11 suspensions |
| `conformance/boundary.json` | `boundary.ts` | `tests/boundary.rs` | 36 crossing programs, 38 runtime configurations |
| `conformance/streaming.json` | `streaming.ts` | `tests/streaming.rs` | 693 programs, 59 suspensions |

- Each generator states, at its top, the host globals and runtime options it uses. The Rust replays define the same
  ones; `conformance/reference.ts` and `conformance/reference.rs` share the `tools` namespace.
- `tests/host.rs` mirrors `test/language.test.ts`.
- Round-trip mode (`PSYCHOSCRIPT_ROUNDTRIP=1`) saves every run to bytes and restores it into a fresh VM at each host
  stop and loop slice. It shows the VM's whole state is plain data.
- One behaviour is not recorded: a suspend refused for exceeding `maxBytes`. Its message contains the snapshot's
  byte size, and each implementation's snapshot has its own format.
- test262 runs both ways (`bash test262/run.sh`): 13444 of 13444 files of the reference's pinned set pass. The list
  of reference-passing files Rust fails is empty, and so is the list of files Rust passes that the reference skips.

## Performance

`bench/RESULTS.md` compares both implementations on the nine bench programs and the plugin-event program, all run
through the reference's language runtime with the same `tools` namespace. It covers per-case time, cold start,
peak RSS, binary size and perturbed variants; the table states the command and machine.

## Known differences

- A saved state resumes only in the implementation and build that saved it: the snapshot formats differ, and
  TypeScript also resumes only on the build that saved a state.
- The program's result (JSON) and its logs are Rust strings, so an unpaired surrogate in them becomes U+FFFD;
  TypeScript keeps it. Strings crossing as host values are lossless (`HostString`), and `boundary.json` records them.

## Observations on the TypeScript language layer

Recording the language layer surfaced a few behaviours worth a look on the TypeScript side:

- **`length` follows the host callback.** A host function's `length` is the arity of the host's `run` callback, not
  of the parameters the program sees. A function written `(args, call) => ...` has `length` 2.
- **`keys` may throw.** A namespace's `keys` can throw `Host.fail` (that is how an unknown path fails), but
  `Host.namespace`'s docs don't mention it.
- **`Host.missing` throws at the call.** When `resolve` gives `Host.missing`, calling that path throws
  synchronously, even where the program expects a promise.

## Before merging

This lands once the repository has the language/Code Mode split and the TypeScript changes it was recorded
against. These TypeScript changes from the staging branch belong to the language layer and come with it:

- JavaScript correctness:
  - functions, generators and iterators convert through ToPrimitive;
  - `new` evaluates its arguments before checking the constructor;
  - `o.x = v` evaluates `v` before checking `o`;
  - `delete` on a primitive base is true unless the wrapper owns the key;
  - built-in object details;
  - `in` finds an array hole's inherited index;
  - Array arguments, lengths and sort elements convert through ToPrimitive.
- acorn 8.16, for Unicode 17 identifiers.
- A blocking host call inside a sync generator parks up to the nearest async boundary (`generators.ts`). Its test
  drives it through Code Mode's `search`, so the test moves with Code Mode or is rewritten with a sync-thenable host
  function.
- The test262 skip-list updates, `interpreter-support.md`, and the `AGENTS.md` line on keeping both implementations
  equally capable.

## Checks

```sh
cargo fmt --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
PSYCHOSCRIPT_ROUNDTRIP=1 cargo test --locked -p psychoscript-bench --test conformance
bun conformance/generate.ts && bun conformance/host.ts && bun conformance/boundary.ts && bun conformance/streaming.ts
git diff --exit-code -- conformance
bash test262/run.sh
bash bench/compare.sh
```
