# PsychoScript (Rust)

A Rust port of OpenCode's Code Mode (`packages/codemode` in anomalyco/opencode, the reference implementation), embeddable in Rust programs with no Bun, Node or other JavaScript engine at build or run time.

## Scope: minimal, targeted

In scope:

- The language subset needed by the nine reference benchmark programs (`conformance/cases/bench-*`), the plugin reducer example, and the other conformance cases.
- Pipeline: parse → compile to bytecode → stack VM. Values cross the host boundary as JSON copies (`serde_json::Value`), never shared.
- Host API in `crates/psychoscript/src/lib.rs`: synchronous tools at dotted paths, JSON bindings, limits (`timeout_ms`, `max_tool_calls`, `max_output_bytes`), `console.log` captured into `logs`.

Out of scope: classes (rejected, like the reference), `export`/modules/`import`, snapshots and suspend/resume, OpenAPI tools, Effect integration, extensions/globals, async host tools, `search`, RegExp, URL, Date, BigInt, Symbol beyond iterators, test262 parity.

## Rules

- Functional style at the API: plugins are programs over data, not objects. Do not add classes to the language.
- Unsupported syntax returns `UnsupportedSyntax` with a location; never panic on user input.
- No `unsafe` unless measured and justified in a comment.
- Dependencies: pure Rust only, and few. Justify each in the commit that adds it.
- `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace` must pass.
- Benchmark claims need the command, machine and numbers in `bench/RESULTS.md`.
- Nothing in the repo mentions internal tooling, private chats, home paths, hostnames or secrets.
