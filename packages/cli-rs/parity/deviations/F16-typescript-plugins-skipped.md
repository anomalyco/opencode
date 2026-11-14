# F16: TypeScript TUI plugins are skipped; native plugins load instead

**TypeScript.** The plugin host (`packages/tui/src/plugin/context.tsx:290-420`) loads every `cli.json`
`plugins` entry that names no built-in, every directory under the `plugins` directories, and the server's
TUI plugins, then runs each one's `setup` beside the built-ins.

**Rust.** The registry (`crates/plugin/src/lib.rs`, `docs/P.1.md`) applies the entries that select
built-ins (`-<id>`, `<id>`, `*`, `<prefix>.*`) exactly as TS does. The loader (`crates/plugin/src/loader`,
`docs/P.4.md`) discovers the same targets as TS: the subdirectories of the `plugins` directories and the
`cli.json` entries that name no built-in. A target with a native build (a shared library on the C ABI of
`opencode-plugin-abi`) loads, with hot reload. Every other target is a TypeScript plugin: the registry lists
it with status `Skipped` and the message "TypeScript TUI plugins do not run in opencode-native yet", and the TUI
logs it once at startup. A skipped plugin's slot claims, commands, and routes are absent. The server's TUI
plugins (`GET /api/plugin` with `features.tui`) are TypeScript packages and are not loaded.

With `OPENCODE_PLUGIN_JS=1` (P7, off by default), a directory target without a native build runs on the JS host, a
Bun process the client starts (`docs/P.4.md`, "TypeScript plugins on the JS host"). Its setup gets the part of the V2
context that maps without Solid, so a plugin that renders JSX, claims a slot or opens a dialog fails in setup until the
compatibility layer (P8). Plugins installed from npm by name are not loaded. One found in a project's `.opencode/plugins` waits for the user's
approval first (`F16-project-plugin-approval`). What does load is a second timing tier: a
tree, an effect and a read arrive a paint late or more, there is no `layout` call, and a handler that throws fails the
plugin with none of its effects (as `F16-plugin-panic-no-effects` does in process), where TS keeps them and the plugin.
A key reaches a handler a round trip late, so the host consumes what the plugin declared (a bind's key, a paste, a
press) and a listener of every key only hears; a key that switches a mode holds the next ones until its answer applied
(`hold`). All TypeScript plugins share one process: when it ends (a plugin hung, crashed or flooded it, or it went
over its memory), every other plugin is set up again with new state, where TS's plugins share the TUI's process and
die with it. The calls the process never started run once on the next one; the one it ran is not run again.

**Reason.** User decision Q5: external plugins become Rust plugins; P.4 loads them as native shared
libraries (decision O-42). The Rust client cannot run TypeScript.
