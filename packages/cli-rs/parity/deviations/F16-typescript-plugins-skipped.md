# F16: TypeScript TUI plugins are skipped; native plugins load instead

**TypeScript.** The plugin host (`packages/tui/src/plugin/context.tsx:290-420`) loads every `cli.json`
`plugins` entry that names no built-in, every directory under the `plugins` directories, and the server's
TUI plugins, then runs each one's `setup` beside the built-ins.

**Rust.** The registry (`crates/plugin/src/lib.rs`, `docs/P.1.md`) applies the entries that select
built-ins (`-<id>`, `<id>`, `*`, `<prefix>.*`) exactly as TS does. The loader (`crates/plugin/src/loader`,
`docs/P.4.md`) discovers the same targets as TS: the subdirectories of the `plugins` directories and the
`cli.json` entries that name no built-in. A target with a native build (a shared library on the C ABI of
`opencode-plugin-abi`) loads, with hot reload. Every other target is a TypeScript plugin: the registry lists
it with status `Skipped` and the message "TypeScript TUI plugins do not run in opencode-rs yet", and the TUI
logs it once at startup. A skipped plugin's slot claims, commands, and routes are absent. The server's TUI
plugins (`GET /api/plugin` with `features.tui`) are TypeScript packages and are not loaded.

**Reason.** User decision Q5: external plugins become Rust plugins; P.4 loads them as native shared
libraries (decision O-42). The Rust client cannot run TypeScript.
