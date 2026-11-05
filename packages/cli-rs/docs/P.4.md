# P.4 external plugins (`rs-plugin-loader`)

Row F16. External TUI plugins are native shared libraries (`.so`, `.dylib`, `.dll`) loaded with `libloading`
behind a stable C ABI (decision O-42, which replaces the WASM design of O-7 and O-40). There is no sandbox: a
plugin is code the user chose to run on their own machine. No cargo feature gates it; `libloading` is small.

## The ABI

`crates/plugin-abi` (`opencode-plugin-abi`) is the contract, and the only crate a plugin depends on. A plugin
exports one symbol, `opencode_plugin_v1`, that returns a `#[repr(C)]` table, `PluginApi`:

| Entry | Since | Purpose |
| --- | --- | --- |
| `size`, `major`, `minor` | 1.0 | Read first, before anything else |
| `requires_minor` | 1.0 | The oldest host minor version the plugin works with |
| `create(host, options, &instance, &out)` | 1.0 | Runs the setup; writes the manifest JSON |
| `call(instance, request, &out)` | 1.0 | Handles a request; writes the result JSON |
| `destroy(instance)`, `free(buffer)` | 1.0 | Ends an instance; frees a buffer the plugin wrote |
| `describe(&out)` | 1.1 | Optional (nullable): the plugin's metadata, such as its version |

The host passes a `HostApi` table of the same shape (`size`, `major`, `minor`, `ctx`, `call`, `free`). Past
the tables, everything crosses as JSON in byte buffers: the `Manifest`, a `Request` from the host (`fence`,
`slot`, `route`, `command`), and a `HostRequest` from the plugin (`log`, `toast`, `storage-get`,
`storage-set`, `open-route`). Each side frees the buffers it allocated, so each keeps its own allocator.

Versions only grow by appending:

- A new entry goes at the end of a table and is optional. A reader treats entries past the other side's
  `size` as absent, so a plugin built against ABI 1.0 loads on a 1.1 host.
- JSON payloads only gain optional fields; readers ignore fields they do not know.
- A plugin built against a newer minor version loads on an older host and uses what the host offers: the host
  answers a request it does not know with an error. A plugin that cannot work without a newer host sets
  `requires_minor`, and the host refuses it with a message naming both versions.
- Only a deliberate major-version break refuses a plugin. The host reads `major` before anything else, and
  the plugin manager shows why: "plugin ABI 2.0 is not supported: this opencode-rs loads ABI 1.x plugins
  (up to 1.1); rebuild the plugin against opencode-plugin-abi 1".

A Rust-ABI `dylib` was rejected because it breaks with every compiler or crate version.

## Writing a plugin

A Rust plugin is a `cdylib` that calls `export_plugin!("my.plugin", setup)`. The macro generates the table and
the shims. `setup(&mut Setup)` registers the P.1 surface as data, because widgets and closures cannot cross
the boundary:

| P.1 (`opencode_plugin::Setup`) | ABI (`opencode_plugin_abi::Setup`) |
| --- | --- |
| `layer` (commands, palette, slash, keybinds) | `command(Command, run)`; the host builds the keymap layer |
| `code_block(language, render)` | `code_block(language, render(&Fence) -> Option<Vec<Line>>)` |
| `slot(placement, render)` | `slot(SlotKind, path, render(session_id) -> Vec<Line>)` |
| `route(name, render)` | `route(name, render() -> Vec<Line>)` |
| `storage_key(key)` | `storage_key(key)`; `Host::storage_get` and `storage_set` on `plugin.<id>.<key>` |
| `on_dispose` | the instance is destroyed on deactivation |

A `Line` is a list of spans with text, colors, and bold, italic, underline, and dim. A color is a theme token
path (`text.muted`, `markdown.heading`) or `#rrggbb`, so plugins follow the theme. The host draws rows without
wrapping; a fence scrolls sideways like the LaTeX and Mermaid renderers. `Setup::options()` holds the
`options` of the plugin's `plugins` entry as JSON text. Other languages implement the same structs and JSON.

What does not cross: arbitrary widget trees, mouse handlers, and live store access (`api.state`). A slot or
route is drawn when it mounts, and again when the route remounts (hot reload, toggles, navigation).

## Discovery

The same targets as TS (`plugin/discovery.ts`, `plugin/context.tsx` reconcile):

1. Every subdirectory of the `plugins` directories: the global config directory's, then each `.opencode` from
   the project root (nearest `.git` or `.hg`) down to the working directory.
2. Each `cli.json` `plugins` entry that names no built-in. Relative paths start at the config directory.

Targets merge by local path; a later entry replaces an earlier one in its place. A target has a native build
when it is a shared library, or a directory with `plugin.so` (`plugin.dylib`, `plugin.dll`). Every other
target is a TypeScript plugin and is listed as skipped (F16). Server-side TUI plugins (`GET /api/plugin` with
`features.tui`) are TypeScript packages and are not loaded.

## Lifecycle

- `Loader::reconcile` loads new and changed builds (by content digest), unloads removed ones, and remounts the
  route when anything changed. A build that fails while a previous version runs keeps the previous version
  and reports `… (previous version still active)`, as TS does.
- Each build is copied to a file of its own before it is opened, because the platform loader returns a
  library already open at the same path, and build tools often write a new build over the old one. Libraries
  are never unloaded: a running plugin's code must outlive every pointer into it, so a reload leaks one
  mapping.
- Hot reload: the TUI watches `Loader::watch_dirs` (the `plugins` directories, each plugin directory, and the
  directory of each configured library) with `opencode_local::watch` and a 100 ms debounce (TS
  `context.tsx`), and reconciles on change. `OPENCODE_FILEWATCHER_DISABLE` turns it off (L09).
- The registry keeps an external plugin's place on reload, so slot order holds. `plugins` directives after
  its entry (all of them, for a discovered plugin) decide whether it starts enabled; the plugin manager
  toggles it.

## Failures

- The shims catch the plugin's panics, and the host's callbacks catch the host's, so no panic unwinds across
  the boundary. The shims also silence the plugin's own panic hook, which would print over the TUI.
- A panic fails the plugin: it is not called again, its fences fall back to the code view, its slots and
  routes draw empty, the plugin manager lists it as `failed` with the message, and an error toast says
  "Plugin failed: <id>". Enabling it again in the plugin manager starts a fresh instance.
- A crash that is not a panic, such as a segfault, ends the TUI. There is no sandbox to contain it.
- Host effects (toasts, routes) run after the call returns, so a plugin never reenters itself through the
  host.

## Sample and tests

`crates/plugin/examples/sample` is a small `cdylib` with its own workspace and `Cargo.lock`, so it is not a
member of the client's workspace and the other crates build as before. Its features select variants: `v2`
draws differently (the reload tests), and `abi-1-0`, `minor-newer`, `major-2`, and `requires-future` pretend
to target other ABI versions. The tests build each variant once per test run into `target/sample-plugin`:
the loader's unit tests in `crates/plugin/src/loader/native/tests.rs`, and the TUI tests in
`crates/tui/tests/all/plugins.rs`.
