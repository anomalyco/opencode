# F16: configured TypeScript TUI plugins are skipped

**TypeScript.** The plugin host (`packages/tui/src/plugin/context.tsx:290-420`) loads every `cli.json`
`plugins` entry that names no built-in, every directory under the `plugins` directories, and the server's
TUI plugins, then runs each one's `setup` beside the built-ins.

**Rust.** The registry (`crates/plugin/src/lib.rs`, `docs/P.1.md`) applies the entries that select
built-ins (`-<id>`, `<id>`, `*`, `<prefix>.*`) exactly as TS does. Every other entry is not loaded: the
registry lists it with status `Skipped` and the message "TypeScript TUI plugins do not run in opencode-rs
yet", and the TUI logs it once at startup. Plugin directories and the server's TUI plugins are not read.
A skipped plugin's slot claims, commands, and routes are absent.

**Reason.** User decision Q5: external plugins become Rust plugins; P.4 loads them as WASM components on
`wasmtime` (decision O-7). The Rust client cannot run TypeScript.
