# PsychoScript (Rust)

The Rust implementation of the PsychoScript language layer, whose reference implementation is `src/language/` of `packages/codemode` (the `Language` namespace: `Runtime.make`, `Host`, programs, suspend and resume, snapshots). It embeds in Rust programs with no Bun, Node or other JavaScript engine at build or run time. Code Mode (`src/codemode/` of the reference: tools, schemas, the catalog, `search`, OpenAPI, hooks, `maxToolCalls`) is not part of this crate.

## Parity with the reference language layer

This package is a second way to run and embed the same language, not a replacement. The two must stay equally capable in both directions.

- A language feature, built-in or host API lands in both or in neither. Rust-native forms of a reference API (futures instead of Effects, closures or traits instead of services) are fine; Rust-only capabilities are not.
- The public API in `crates/psychoscript/src/lib.rs` is the Rust form of `src/language/index.ts`; the README maps one to the other. Keep that table current.
- Known differences are listed in the README; add to that list only with the owner's agreement, and prefer removing one.

## Conformance

The recordings are generated from the reference's language layer; never edit them by hand. CI regenerates them and fails on any difference. Each generator's top comment states the host globals and runtime options it uses, which the Rust replays define the same way (`conformance/reference.ts` and `conformance/reference.rs` share the `tools` namespace):

- `conformance/cases/*.json` by `bun conformance/generate.ts`, replayed by `bench/tests/conformance.rs`.
- `conformance/host.json` by `bun conformance/host.ts` (host functions: types, keys, idempotent and durable calls across a suspend, namespaces, failures, `run.metadata`, translation, limits), replayed by `crates/psychoscript/tests/host_recording.rs`.
- `conformance/boundary.json` by `bun conformance/boundary.ts` (values crossing the host boundary, globals, module names and imports), replayed by `crates/psychoscript/tests/boundary.rs`.
- `conformance/streaming.json` by `bun conformance/streaming.ts` (streaming responses, host-call arguments, fuel, suspensions), replayed by `crates/psychoscript/tests/streaming.rs`.
- `crates/psychoscript/tests/host.rs` mirrors the reference's `test/language.test.ts`.

## Scope

- Pipeline: parse → compile to bytecode → stack VM. Values cross the host boundary as copies (`HostValue`), never shared.
- Out of scope, as in the reference: classes (rejected), `export`, BigInt, Symbol beyond the well-known iterators.

## Rules

- Functional style at the API: plugins are programs over data, not objects. Do not add classes to the language.
- Unsupported syntax throws `UnsupportedSyntax` with a location where it runs; never panic on user input.
- No `unsafe` unless measured and justified in a comment.
- Dependencies: pure Rust only, and few. Justify each in the commit that adds it.
- test262 parity runs both ways: `bash test262/run.sh` must pass, and `test262/rust-skipped.txt` and `test262/reference-gaps.txt` may only shrink.
- `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace` must pass.
- The conformance cases must also pass in round-trip mode, which saves and restores every run at each host stop and after 64, 128, 256, … loop iterations: `PSYCHOSCRIPT_ROUNDTRIP=1 cargo test -p psychoscript-bench --test conformance`.
- Benchmark claims need the command, machine and numbers in `bench/RESULTS.md`, measured against the reference's language layer by `bash bench/compare.sh`.
- CI: the `unit` job of `.github/workflows/check-test.yml` runs these checks, round-trip conformance, conformance freshness, test262 and the informational bench on Linux, whenever `packages/codemode`, `packages/codemode-rust` or that workflow changed.
- Nothing in the repo mentions internal tooling, private chats, home paths, hostnames or secrets.
