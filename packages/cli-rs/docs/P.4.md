# P.4 external plugins (`rs-plugin-loader`)

Row F16. External TUI plugins load as WebAssembly components on `wasmtime` (decision O-7), behind the cargo
feature `plugins-wasm` that only the `opencode-rs` binary turns on (O-40).

## Surface

The contract is `crates/plugin/src/loader/wit/plugin.wit`, world `plugin`. A component cannot hold widgets or
closures, so the P.1 API crosses the boundary as data:

| P.1 (`Setup`) | WIT |
| --- | --- |
| `layer` (commands, palette, slash, keybinds) | `manifest.commands`; the host calls `run-command(name, input)` |
| `code_block(language, render)` | `manifest.fences`; `render-fence(fence) -> option<list<line>>` |
| `slot(placement, render)` | `manifest.slots` (kind and path); `render-slot(path, session-id) -> list<line>` |
| `route(name, render)` | `manifest.routes`; `render-route(name) -> list<line>` |
| `storage_key(key)` | `manifest.storage`; imports `storage-get` and `storage-set` on `plugin.<id>.<key>` |
| `on_dispose` | the instance is dropped on deactivation |

A `line` is a list of spans with text, colors, and bold, italic, underline, and dim. A color is a theme token path
(`text.muted`, `markdown.heading`) or `#rrggbb`, so plugins follow the theme. The host draws rows without
wrapping; a fence scrolls sideways like the LaTeX and Mermaid renderers. Imports: `log`, `toast`, `storage-get`,
`storage-set`, `open-route`. `setup(options)` receives the `options` of the plugin's `plugins` entry as JSON text.

What does not cross: arbitrary widget trees, mouse handlers, and live store access (`api.state`). A slot or route
is drawn when it mounts; it is drawn again when the route remounts (hot reload, toggles, navigation).

## Discovery

The same targets as TS (`plugin/discovery.ts`, `plugin/context.tsx` reconcile):

1. Every subdirectory of the `plugins` directories: the global config directory's, then each `.opencode` from
   the project root (nearest `.git` or `.hg`) down to the working directory.
2. Each `cli.json` `plugins` entry that names no built-in. Relative paths start at the config directory.

Merged by local path, a later entry replacing an earlier one. A target has a WASM build when it is a `.wasm`
file, or a directory with `plugin.wasm`. Every other target is a TypeScript plugin and is listed as skipped
(F16). A WASM target in a build without `plugins-wasm` is skipped with that reason.

Server-side TUI plugins (`GET /api/plugin` with `features.tui`) are not loaded: they are TypeScript packages.

## Lifecycle

- `Loader::reconcile` loads new and changed builds (by content digest), unloads removed ones, and remounts the
  route when anything changed. A build that fails while a previous version runs keeps the previous version and
  reports `… (previous version still active)`, as TS does.
- Hot reload: the TUI watches `Loader::watch_dirs` (the `plugins` directories, each plugin directory, and the
  directory of each configured `.wasm`) with `opencode_local::watch` and a 100 ms debounce (TS `context.tsx`),
  and reconciles on change. `OPENCODE_FILEWATCHER_DISABLE` turns it off (L09).
- The registry keeps an external plugin's place on reload, so slot order holds. `plugins` directives after its
  entry (all of them, for a discovered plugin) decide whether it starts enabled; the plugin manager toggles it.

## Isolation

- Each activation gets a fresh instance with a 64 MiB memory limit.
- Every call runs under an epoch deadline (250 ms; a 10 ms clock thread). A guest that loops is interrupted.
- A trap (panic, interrupt, out of memory) fails the plugin: it is not called again, its fences fall back to the
  code view, its slots and routes draw empty, the plugin manager lists it as `failed` with the error, and an
  error toast says so. Toggling it in the plugin manager starts a fresh instance.
- Host effects (toasts, routes) run after the call returns, so a guest cannot reenter itself through the host.

## Build cost (O-40)

`opencode-plugin` has the feature `plugins-wasm` (wasmtime with only `runtime`, `cranelift`, and
`component-model`), and `opencode-cli` forwards it. The TUI and UI crates and their tests never enable it, so
their builds do not compile wasmtime. The step report has the release size and build time with and without it.

## Sample

`crates/plugin/examples/sample` is a tiny Rust guest (`wit-bindgen`). `build.sh` builds `sample-v1.wasm` and
`sample-v2.wasm` (they differ in what they draw, for the reload test). Without the `wasm32-wasip2` target it
builds std for `wasm32-unknown-unknown` from rust-src and wraps the module with `wasm-tools component new`.
