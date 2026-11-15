# F16: TypeScript TUI plugins run on the JS host when Bun is found; native plugins load beside them

**TypeScript.** The plugin host (`packages/tui/src/plugin/context.tsx:290-420`) loads every `cli.json`
`plugins` entry that names no built-in, every directory under the `plugins` directories, and the server's
TUI plugins, then runs each one's `setup` beside the built-ins.

**Rust.** The registry (`crates/plugin/src/lib.rs`, `docs/P.1.md`) applies the entries that select
built-ins (`-<id>`, `<id>`, `*`, `<prefix>.*`) exactly as TS does. The loader (`crates/plugin/src/loader`,
`docs/P.4.md`) discovers the same targets as TS: the subdirectories of the `plugins` directories and the
`cli.json` entries that name no built-in. A target with a native build (a shared library on the C ABI of
`opencode-plugin-abi`) loads, with hot reload. A directory target without one is a TypeScript plugin: when Bun is
found (`OPENCODE_BUN`, the local server's opencode binary run as its own Bun, or `bun` on the path) and `OPENCODE_PLUGIN_JS` is `1` (off by default), it runs on the JS host, a Bun process
the client starts (`docs/P.4.md`, "TypeScript plugins on the JS host"), through the V2 compatibility layer (P8), which
gives a V2 `{ id, setup }` module the context and the modules TS gives it. Without Bun, or without `OPENCODE_PLUGIN_JS=1`,
the registry lists it with status `Skipped` and the reason "TypeScript TUI plugins run on the JS host, which is off: set
OPENCODE_PLUGIN_JS=1 (with Bun installed) to turn it on"; its slot claims, commands and routes are absent. Plugins named
by npm package are not installed or loaded ("opencode-native does not install or load TUI plugins named by npm
package"), with the JS host on or off. The TUI parts of the server's plugins (`GET /api/plugin`, active with
`features.tui`, which TS loads as `serverTuiPlugins`) are not loaded either ("opencode-native does not load the TUI part
of a server plugin"); each is listed by its package target or path beside the server plugin's own row.

Where TS draws these plugins, the Rust client tells the user once a run, in the host's notice lane (a warning toast that
stays, with "Open plugins", as its "Plugin failed" toast is told; no plugin's toast hides it): "N TypeScript plugins
not loaded", then one line per reason naming the plugins, then "Run /plugins to view details." It waits for the server's
plugin list, so the server plugins' TUI parts are in the same notice; one found later (a config change, a new
directory, a new server plugin) is told then, once. `/plugins` lists each as a TUI row `skipped`, named by the `name` of
its directory's `package.json` where there is one, else by its target, with the reason as its error; the log has
`plugin <target> skipped: <reason>` once for each. `scenarios/F16/ts-plugins-skipped.pty.ts` drives it: a server plugin
whose TUI part TS loads and Rust lists as skipped, with the notice.

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
