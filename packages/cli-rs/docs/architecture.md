# Architecture

`opencode-native` is a client of the OpenCode server. It finds or starts the TypeScript `opencode` server and talks
to it over HTTP. It is held to the behavior of the TypeScript client (`packages/cli`, `packages/tui`): most modules
port a TypeScript module and name it in their documentation, a deliberate difference is a file in
`parity/deviations/`, and [`testing.md`](testing.md) describes how the two are compared. Paths are relative to
`packages/cli-rs`.

## Crates

Crate `opencode-<name>` is in `crates/<name>`. A crate depends only on crates above it in this list:

- `util`: small shared helpers: temporary directories, `dlopen`, process jobs, time, hashing.
- `api-types`: the generated API types and request builders, with no transport. The plugin SDK uses it too.
- `api`: the HTTP client: the generated methods, transports, the event stream, sockets.
- `local`: the client-local files shared with the TypeScript client.
- `service`: finding, probing, starting and stopping the server.
- `store`: the client's copy of the server's state, fed by the event stream.
- `plugin-abi`: the plugin contract and the SDK of native plugins.
- `ui`: themes, keymap, dialogs, content widgets, grammars.
- `plugin`: the plugin host: registry, loader, carriers, the renderer of plugin trees.
- `latex`, `mermaid`: two built-in plugins, on `plugin-abi` alone.
- `tui`: the full-screen TUI.
- `mini`: `mini`, the interface in the terminal's scrollback.
- `acp`: the ACP agent.
- `drive`: the simulation UI endpoint, which drives a headless TUI.
- `parity`: cell fixtures and comparison, for tests only.
- `cli`: the `opencode-native` binary.

Third-party crates are declared once, in `[workspace.dependencies]`. The [README](../README.md#build) describes the
OpenTUI pin and its native library.

## The command line

`crates/cli` parses the command line as the TypeScript CLI does: the same commands, aliases, flags, help, completion
scripts and usage errors. `src/args.rs` declares the command tree as a static table, `src/parse.rs` ports Effect
CLI's parser with its error messages, and `src/commands/` has one module for each command (`default.rs` is the TUI).
Two tests hold the table to the TypeScript tree: `src/tests/tree.rs` against the tree that `script/gen/commands.ts`
dumps, and `src/tests/output.rs` byte for byte against the help and usage errors that `script/gen/cli-output.ts`
records.

`serve`, `uninstall` and `plugin` run the TypeScript `opencode` with the same arguments, streams and exit code
(`crates/service/src/delegate.rs`). `plugin dev` and `plugin test` are the client's own
([`plugins.md`](plugins.md#plugin-dev-and-plugin-test)).

## Talking to the server

### The API client

`script/gen/api.ts` generates the client from the server's API definition (`ClientApi` in `@opencode/protocol`):
the types (`crates/api-types/src/types.rs`), one request builder for each endpoint that returns a typed `Call<T>`
(`crates/api-types/src/client.rs`), and one `async` method on `Client` that sends it
(`crates/api/src/generated/methods.rs`). A method is named by its path in snake case (`session.message.get` is
`session_message_get`), and takes one struct with every path parameter, query field, header and payload field.

The types decode what a newer server sends. Unknown fields are ignored. A string-literal enum has an
`Unknown(String)` variant and an object union an `Unknown(serde_json::Value)` variant. An optional nullable field is
`Option<Option<T>>`, so absent and `null` stay distinct. A branded string is a newtype (`SessionID`), and a declared
error implements `TaggedError`.

In `crates/api/src`, `client.rs` holds the base URL, authentication, headers and declared errors; `transport.rs` the
`Transport` trait and its `reqwest` implementation; and `memory.rs` a transport that serves recorded responses and
events, which tests use in place of a server.

### Events and sockets

`events.rs` subscribes to `/api/event`. The stream must start with `server.connected`. A silent stream is replaced,
a disconnect reconnects, and events reach the consumer in small batches with adjacent deltas merged. The batch queue
is bounded: when it is full the loop reconnects, and the consumer resynchronizes on the next `server.connected`.
`ws.rs` opens WebSockets, with a ticket where needed: `pty.rs` is the terminal socket and `client_mcp.rs` the socket
on which the client serves MCP tools to the server.

### Finding and starting a server

`connect::resolve` in `crates/service` picks the server:

1. `--server <url>`.
2. `--standalone`, or a service config with `disabled: true`: a private server for this client, with a random
   password, run as `<opencode> serve --stdio --port 0`. Its standard input is the lease: it exits when the client
   does.
3. The first ready, compatible service among the registrations in the state directory (`discover.rs`, `probe.rs`).
4. Otherwise `ensure` starts the background service, `<opencode> serve --service`, and waits for it.

`<opencode>` is `OPENCODE_TS_BIN`, else the `opencode` beside the client, else `opencode` on `PATH`
(`ts_command.rs`). The rules of `ensure.rs`:

- **It starts a service only when none runs,** and waits for one that is starting.
- **It never stops a service it did not start,** with one exception: the TUI and `mini` restart a service of another
  version registered in the client's own channel, as the TypeScript ones do, and hand its terminals over
  (`handoff.rs`). With `--server` they only warn.
  [`parity/deviations/S03-never-replace.md`](../parity/deviations/S03-never-replace.md) has the differences from
  TypeScript.
- **An unresponsive service is left running.** Three failed probes in a row fail the command with a message that
  names it. A registration whose process is gone is evicted.
- **A start is a detached process** (`spawn.rs`, `contender.rs`). At most two are alive, a startup failure is
  reported once none is left, and clean exits back off.

A restarted service may register a new port or password. In `follow.rs`, a request that fails to connect, or gets a
401, finds the service again before it returns its error. It is not retried, so a request that may have reached the
old service is never sent twice. `stop.rs` serves `service stop`, `restart` and `set`.

## Client-local files

`crates/local` reads and writes the files the client shares with the TypeScript client, with the same paths, lock
(`lock.rs`, compatible with the TypeScript `Flock`) and atomic writes, so the two run side by side:

- paths (`paths.rs`, `channel.rs`): the XDG roots, `OPENCODE_CONFIG_DIR`, and the channel that picks the registration
  and storage files;
- `cli.json` (`cli_config.rs`, `jsonc.rs`, `migrate.rs`): decoding is strict, so a wrong type anywhere reads the
  document as `{}`, and unknown keys are dropped;
- TUI storage (`storage.rs`): `<state>/<channel>/tui/<key>.json`, kept as `serde_json::Value`, so fields the other
  client wrote survive a write;
- prompt history, stash and frecency (`jsonl.rs`), `model.json` (`model_pref.rs`), pinned sessions (`pins.rs`,
  `<state>/session.json`), and the service registration and config (`registration.rs`, `service_config.rs`:
  `service.json` or `service-<channel>.json`).

`jsonc.rs` ports the parts of `jsonc-parser` the TypeScript client uses, because an update of `cli.json` must keep
the user's comments and formatting byte for byte as TypeScript writes them, and other JSONC libraries format edits
differently. `watch.rs` watches a directory with a 50 ms debounce; `OPENCODE_FILEWATCHER_DISABLE` (or
`OPENCODE_DISABLE_FILEWATCHER`) set to `1` or `true` turns every watch off. `serial.rs` runs blocking file jobs in
order on a worker thread, so a write that waits on the lock stays off the UI thread.

## The store

`crates/store` ports `createData` of the TypeScript client: sessions and their families, status, messages and parts,
pending inbox items, permissions, forms, projects, shells and locations.

- **`Data`** is a cheap `Clone` handle around one locked `State`, read with `data.read(|state| …)`. The lock is never
  held across an `.await`, and a store action may not run inside a read.
- **Requests** run on the store's tokio runtime, so the handle works from the UI thread. Concurrent reads of the same
  thing share one load.
- **Events.** `connection.rs` applies each batch under one flush and reads again what it leaves stale. A lost
  connection invalidates cached reads, and `server.connected` rehydrates.
- **Change tracking** (`changes.rs`). Each mutation records what it touched in a `Changes`. A flush gets a revision,
  the last 256 are kept, and the revision goes out on a watch channel. A view keeps the revision it last rendered and
  asks `changes_since(seen)`: the union of the newer flushes, or `Changes::everything()` once its revision fell out
  of the log. So any number of views observe independently, with bounded memory.

## The UI kit

`crates/ui` holds what the TUI and its dialogs are built from:

- **Themes** (`theme/`): built-in, custom and `system` themes, resolved into semantic tokens.
- **Keymap** (`keymap/`): `TuiKeymap` on `opentui::keymap`, with command layers, the input mode stack and the timed
  leader key. `Keybinds::resolve` resolves `cli.json`'s `keybinds` over the generated defaults.
- **Dialogs**: the dialog stack, select, prompt, confirm, alert, toasts and the command palette.
- **Content**: the Markdown, code and diff views, and the prompt's editor (`prompt_input/`).
- **Grammars** (`grammars/`): tree-sitter grammars linked statically, with the TypeScript TUI's highlight queries.
  The default feature `grammars` adds those OpenTUI does not link. Kotlin, OCaml, F# and Swift are not linked
  ([`parity/deviations/H06-highlight-queries.md`](../parity/deviations/H06-highlight-queries.md)).

## The TUI

`crates/tui` is the full-screen TUI. `app::run` runs it on the terminal, and `app::mount` builds it on any `App`,
including a test's.

### Threads

The UI thread owns every widget, because OpenTUI's handles are not `Send`. Network work runs on the app's tokio
runtime (`Tui::request` hands the result back), and blocking file work on worker threads. One task (`pump` in
`app.rs`) forwards the store's flushes, its signals and the connection status to the UI thread, and posts a
`DataChanged` only when none is pending, so at most one wake is queued however fast the store flushes. Every queue
between a task and the UI is bounded.

### Routes and views

`app::Tui`, held as `Rc<Tui>`, is the one shared context: the app, the store (`data`), keymap, dialogs, toasts,
theme, config, plugin registry, tabs, frame and current route. Widget callbacks keep a `Weak<Tui>`.

`routes::Route` is `Home`, `Session { id }` or `Plugin { id, name }`. A mounted route implements `RouteView`:

```rust
pub trait RouteView {
    fn root(&self) -> View;
    fn sync(&self, tui: &Tui, changes: &Changes);
    fn focus_target(&self) -> Option<AnyWidget> { None }
    fn restyle(&self, _tui: &Tui) -> bool { false }
}
```

`Tui::navigate(route)` mounts the new view and syncs it once with `Changes::everything()`. After that, each wake from
the store calls `data.changes_since(seen)` once and passes the result down, and each view updates only the widgets
the changes name. Parts of a view (the transcript, the permission prompt, the sidebar) and open dialogs (through
`Tui::follow`) sync the same way. `restyle` takes a new theme in place; a view that returns `false` is mounted again.

### The screen

```text
shell (column)
├── body (row)                                   frame::Frame
│   ├── rail            vertical tabs            tabs::rail, when tabs show and are vertical
│   ├── column
│   │   ├── strip       horizontal tabs          tabs::strip, when tabs show and are horizontal
│   │   ├── main        the route's view         routes::*
│   │   └── the `app` plugin slot
│   └── rail handle     resizes the rail         frame::resize
├── toasts, the DevTools bar
plugin overlays (absolute), dialogs (absolute, above them)
```

Tabs show when they are enabled, at least one is open, the route is not a plugin's, and no panel is full screen. The
rail is used when there is room for it and the session; otherwise the strip.

```text
session frame (row)                              frame::SessionFrame, routes/session/
├── session pane (column)
│   ├── transcript      messages::list, sticky to the bottom
│   ├── queued          the queued prompts
│   ├── composer top    the `session.composer.top` plugin slot
│   ├── composer        subagents, shell and terminals tabs; replaces what is below while it shows
│   ├── permission      a pending permission request; the prompt hides while it shows
│   ├── form            a pending form
│   └── prompt          prompt::editor
├── right pane          a plugin's panel (panel::Host), or the selected terminal
├── pane handle         resizes the right pane
└── sidebar             routes::session::sidebar, beside the session when the terminal is wide, or opened
```

A panel goes full screen, hiding the session pane and the tabs, when the room is too narrow to split or the plugin
asks. The rail's and the pane's widths are kept in the `layout` storage key.

### Keys and theme

`app.rs` sends every key to the keymap before any widget (`route_keys`). The keymap's focus comes from the focused
widget and its ancestors, and a key the keymap handles stops there. A global layer holds the commands the palette
reaches, and other layers bind keys. `Ctrl+C` reaches the keymap rather than ending the app, so an open dialog closes
first. Plugins' keys go through the same keymap ([`plugin-abi.md`](plugin-abi.md#panels-overlays-and-input)).

`ThemeState` starts from `cli.json`'s `theme`, the terminal's mode and its palette. A change restyles the dialogs,
toasts and view, and writes the name and mode to `cli.json` on a worker thread.

### Modules

- `app.rs`: the shared context, mount, the wake path, the app-wide keys;
- `routes/`: home, the session (transcript, tools, permission, forms, sidebar), a plugin's route;
- `frame/`, `tabs/`, `panel/`: the shell and pane resizing, session tabs, plugin side panels;
- `prompt/`: editor, autocomplete, history, stash, attachments, submit;
- `composer/`, `terminal/`: the composer tabs, terminal panes;
- `dialogs/`: one module for each dialog;
- `features/`: startup, events, title, attention, links;
- `plugins/`: the TUI's side of the plugin host, and the built-in plugins;
- `local.rs`: the model and agent selection;
- `client_mcp/`: the tools the TUI serves to the server.

## Built-in plugins

Every built-in uses the contract external plugins use ([`plugins.md`](plugins.md)). Two are crates of their own, so
the TUI does not rebuild when they change. Both are ports rather than libraries, because the tests compare their
cells with the TypeScript client's:

- **`opencode-latex`** (`opencode.latex`) ports `packages/latex`, with opentui-tex's layout. It draws `latex`, `math`
  and `tex` fences, and Markdown math (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`), as Unicode in terminal cells.
  [`P2-latex-inline.md`](../parity/deviations/P2-latex-inline.md) and
  [`P2-latex-opentui-tex.md`](../parity/deviations/P2-latex-opentui-tex.md) list where it differs.
- **`opencode-mermaid`** (`opencode.merman`) ports `packages/merman` module for module. It draws `mermaid` fences:
  flowcharts, sequence, state, gantt, gitgraph and timeline diagrams. Its streaming fallback depends on the
  TypeScript parser's errors.

## `mini`, ACP and the simulation endpoint

- **`opencode-mini`**: the app lives in a footer at the bottom of the main screen, and the transcript goes to the
  terminal's scrollback above it.
- **`opencode-acp`** (`opencode-native acp`): the Agent Client Protocol over JSON-RPC on standard input and output,
  against a standalone server.
- **`opencode-drive`** (`OPENCODE_DRIVE`): a WebSocket server that drives a headless TUI with keys and mouse events
  and captures its screen, for [P-TUI](testing.md#p-tui-the-simulated-server).

## Generated files

Generated files are committed. `bun run generate` runs every generator in `script/gen/` in name order:

| Generator | Writes |
| --- | --- |
| `api.ts` | The API types, request builders and methods; the Luau client's operations table |
| `commands.ts`, `cli-output.ts` | The CLI's command tree, and its help and usage-error goldens |
| `config.ts`, `keybinds.ts` | The keybind names of `cli.json`, with each default and description |
| `themes.ts` | The built-in themes |
| `grammars.ts` | The highlight queries (`assets/queries/`) |
| `plugin-schema.ts`, `plugin-types-luau.ts` | The plugin contract's JSON Schema, and the Luau type stub from it |
| `js-host.ts` | `compat.js`, the JS host's compatibility layer |
| `accents.ts`, `entities.ts`, `mime.ts`, `structured-patch.ts`, `time.ts` | Tables and known-answer cases from the TypeScript client's libraries |

[`bun run check:drift`](testing.md#generated-files-and-drift) fails when a committed file no longer matches.
