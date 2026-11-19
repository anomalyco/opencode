# PsychoScript (Rust)

A Rust implementation of the PsychoScript language layer: the confined, JavaScript-like language whose reference
implementation is `src/language/` of `@opencode/codemode` (the `Language` namespace). Programs run in a bytecode VM
written in pure Rust, with no Bun, Node or other JavaScript engine at build or run time, and reach only the host
functions the embedder gives them.

Code Mode (tools, schemas, the catalog, `search`, OpenAPI, hooks, `maxToolCalls`) is a layer the reference builds on
the language; it is not part of this crate. A host builds its own layer the same way, from host functions.

## Use

```rust
use psychoscript::{HostFunction, HostValue, Namespace, Failure, Runtime, Limits};

let runtime = Runtime::make()
    // Made when a run starts, and again when it resumes, so globals can keep the run's own state in its metadata.
    .globals(|run| {
        [
            // Synchronous (the default): the program waits for it.
            ("hash", HostFunction::new(|args, _| HostValue::from(sha256(args[0].as_str().unwrap_or(""))))),
            // Asynchronous: the program gets a promise.
            ("sleep", HostFunction::new_async(|args, _| async move { sleep(args[0].as_f64()).await; Ok(HostValue::Undefined) })),
            // Rerun with the same key after a resume.
            ("lookup", HostFunction::new_async(|args, call| async move { db_get(&args[0], call.key()).await }).idempotent()),
            // A lazy, path-addressed object of functions: `api.issues.list()`.
            ("api", Namespace::new(|path| Ok(children_of(path)), |path| fn_at(path).map_or_else(
                || Failure::missing(format!("No api.{}", path.join("."))).into(),
                Into::into,
            )).into()),
        ]
    })
    .limits(Limits { timeout_ms: Some(5_000), max_output_bytes: Some(64 << 10) });

let outcome = runtime.execute("const h = hash('a'); await sleep(1); return h");
```

The API is the Rust form of the reference's `Language` namespace:

| Reference (`src/language/index.ts`) | Rust (`crates/psychoscript/src/lib.rs`) |
|---|---|
| `Runtime.make({ globals, modules, limits, translate })` | `Runtime::make().globals(..).modules(..).limits(..).translate(..)` |
| `Host.fn(f, { type, idempotent, constructible, takesFunctions, snapshot })` | `HostFunction::new` (sync), `new_async`, `.thenable()` (sync-thenable), `.idempotent()`, `.constructible()`, `.takes_functions()`, `.snapshot(encode, decode)` |
| a sync `Host.fn` returning a value, a Promise, or an Effect | `HostValue`/`HostResult`, `Returned::Pending(future)`, `Returned::Block(future)` |
| `Host.durableFn({ start, wait, cancel })` | `DurableFunction::new(start, wait, cancel)` |
| `Host.namespace({ keys, resolve })` | `Namespace::new(keys, resolve)` |
| `Host.fail(kind, message, suggestions)`, `Host.missing(..)` | `Failure::new(kind, message)`, `Failure::missing(message)`, `.suggestions(..)`, `.kind(..)` |
| `Effect.interrupt` from a host function | `Err(HostValue::Interrupt)` |
| `run.id`, `run.metadata` | `Run::id`, `Run::metadata`, `set_metadata`, `update_metadata` |
| `runtime.execute(code, { bindings, runId })` | `execute(code)`, `execute_with(code, &ProgramOptions)`, `execute_async` |
| `runtime.program(..)`, `program.run()`, `program.suspend()` | `Runtime::program`, `Program::run`/`run_resumable`/`run_async`, `Program::suspender()` → `Suspender::suspend` |
| `runtime.resume(state \| bytes)` | `Runtime::resume(&Snapshot)`, `resume_bytes` |
| `toBytes`, `fromBytes`, `SnapshotError`, `SuspendError` | `to_bytes`, `from_bytes`, `SnapshotError`, `SuspendError` |
| `StreamingResponse` | `StreamingResponse` over an `HttpBody` |
| `globalNames` | `global_names()` |
| `Diagnostic`, `DiagnosticKind`, `Json` | `Diagnostic`, `DiagnosticKind`, `Json` (`serde_json::Value`) |
| a run's `Result` (`value`, `logs`, ...) | `Outcome`: `result` as `Data` (JSON whose strings are `HostString`s), `logs` as `HostString`s; `Outcome::json` and `Outcome::log_lines` give them lossily as `serde_json::Value` and `String` |
| a JavaScript string crossing as a host value | `HostString`: lossless, including unpaired surrogates; `as_str`, `to_utf16`, `to_string_lossy` |
| `Json` a host passes or keeps (bindings, `run.metadata`, a durable function's data) | `Data`, which keeps unpaired surrogates; it converts from and to `serde_json::Value` |

Host work is a `Future` instead of an Effect: `Runtime::execute` drives a run on the calling thread, and
`execute_async` and `Program::run_async` run on any executor. Values cross the boundary as copies (`HostValue`); a
string crosses as a `HostString`, which keeps a string with an unpaired surrogate exactly, so a host sees and returns
what the program had. Every string the API hands over that can hold program text is one: values, object keys, error
names and messages, RegExp sources, namespace paths, the result (`Data`), logs, diagnostics and failures, bindings,
run metadata and durable data. URLs, URLSearchParams and Headers stay `String`s, as JavaScript keeps them well
formed too; lossy accessors (`to_string_lossy`, `Data::to_json`, `Outcome::json`, `Outcome::log_lines`,
`Diagnostic::message_lossy`) give Rust `String`s and `serde_json::Value`s when wanted.

## Parity

This crate and the reference language layer must stay equally capable in both directions: a language feature or host
API lands in both or in neither. Rust-native forms of a reference API are fine; Rust-only capabilities are not.

Its expectations are recorded from the reference's language layer, never written by hand (see `AGENTS.md`):

- `conformance/cases/*.js` → `.json` (`bun conformance/generate.ts`), replayed by `bench/tests/conformance.rs`, also in
  round-trip mode (`PSYCHOSCRIPT_ROUNDTRIP=1`, which saves and restores every run at each host stop and loop slice).
- `conformance/host.json` (`bun conformance/host.ts`), replayed by `tests/host_recording.rs`.
- `conformance/boundary.json` (`bun conformance/boundary.ts`), replayed by `tests/boundary.rs`.
- `conformance/streaming.json` (`bun conformance/streaming.ts`), replayed by `tests/streaming.rs`.
- test262, both ways: `bash test262/run.sh`.

`tests/host.rs` mirrors the reference's `test/language.test.ts`.

### Known differences

- A saved state resumes only in the implementation and build that saved it: the snapshot formats differ.

## Layout

- `crates/psychoscript/src/`: compiler (`compiler.rs`, on `oxc_parser`), bytecode and VM (`vm.rs`, `ops.rs`), runtime
  objects and the standard library (`builtins/`), promises and iteration, host functions and their crossing
  (`host_function.rs`, `host.rs`, `cross.rs`, `streaming.rs`), snapshots (`snapshot.rs`), and the runtime and programs
  (`runtime.rs`, `program.rs`, `run.rs`).
- `conformance/`: the generators, their recordings, and `reference.ts`/`reference.rs`, the `tools` namespace they share.
- `bench/`: the benchmark runner, `compare.sh` and `RESULTS.md`, measured against the reference's language layer.
- `test262/`: the test262 parity runner.
