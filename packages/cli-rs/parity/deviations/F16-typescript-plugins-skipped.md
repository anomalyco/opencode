# F16: TypeScript TUI plugins run on the JS host when Bun is found; native plugins load beside them

**TypeScript.** The plugin host (`packages/tui/src/plugin/context.tsx:290-420`) loads every `cli.json`
`plugins` entry that names no built-in, every directory under the `plugins` directories, and the server's
TUI plugins, then runs each one's `setup` beside the built-ins.

**Rust.** The registry (`crates/plugin/src/lib.rs`, `docs/P.1.md`) applies the entries that select
built-ins (`-<id>`, `<id>`, `*`, `<prefix>.*`) exactly as TS does. The loader (`crates/plugin/src/loader`,
`docs/P.4.md`) discovers the same targets as TS: the subdirectories of the `plugins` directories and the
`cli.json` entries that name no built-in. A target with a native build (a shared library on the C ABI of
`opencode-plugin-abi`) loads, with hot reload. A directory target without one is a TypeScript plugin: when Bun is
found (`OPENCODE_BUN`, or `bun` on the path) and `OPENCODE_PLUGIN_JS` is `1` (off by default), it runs on the JS host, a Bun process
the client starts (`docs/P.4.md`, "TypeScript plugins on the JS host"), through the V2 compatibility layer (P8), which
gives a V2 `{ id, setup }` module the context and the modules TS gives it. Without Bun, or without `OPENCODE_PLUGIN_JS=1`,
the registry lists it with status `Skipped` and the message "TypeScript TUI plugins do not run in opencode-native yet",
and the TUI logs it once at startup; its slot claims, commands and routes are absent. Plugins installed from npm by name
are not installed or loaded, and the server's TUI plugins (`GET /api/plugin` with `features.tui`) are not loaded.

What runs on the JS host differs from TS as `F16-v2-compat-layer` says, and one found in a project's
`.opencode/plugins` waits for the user's approval first (`F16-project-plugin-approval`). It is a second timing tier: a
tree, an effect and a read arrive a paint late or more, there is no `layout` call, and a handler that throws fails the
plugin with none of its effects (as `F16-plugin-panic-no-effects` does in process), where TS keeps them and the plugin.
A key reaches a handler a round trip late, so the host consumes what the plugin declared (a bind's key, a paste, a
press) and a listener of every key only hears; a key that switches a mode holds the next ones until its answer applied
(`hold`). All TypeScript plugins share one process: when it ends (a plugin hung, crashed or flooded it, or it went
over its memory), every other plugin is set up again with new state, where TS's plugins share the TUI's process and
die with it. The calls the process never started run once on the next one; the one it ran is not run again.

**Reason.** User decision Q5: external plugins become Rust plugins; P.4 loads them as native shared
libraries (decision O-42). The Rust client cannot run TypeScript in its own process; O-125 and O-128 run today's V2
plugins on a JS host beside it, as the second tier, where their features map.
