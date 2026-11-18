# Architecture

`opencode-native` is a client of the OpenCode server, in Rust on OpenTUI's Rust crates. It is not a server: it finds
or starts the TypeScript `opencode` server and talks to it over HTTP. This document describes how the workspace is
divided, how the client reaches the server, and how the TUI is built. Paths are relative to `packages/cli-rs`.

The client is held to the behavior of the TypeScript client (`packages/cli`, `packages/tui`). Most modules port a
TypeScript module, and name it in their module documentation. A deliberate difference is recorded as a file in
`parity/deviations/`, and [`testing.md`](testing.md) describes how the two clients are compared.

## Crates

Dependencies point down this list: a crate depends only on crates above it.

| Crate | Directory | Contents |
| --- | --- | --- |
| `opencode-util` | `crates/util` | Small shared helpers: temporary directories, `dlopen`, process jobs, time, hashing |
| `opencode-api-types` | `crates/api-types` | The generated API types and request builders, with no transport. The plugin SDK uses it too |
| `opencode-api` | `crates/api` | The HTTP client: the generated methods, transports, the event stream, sockets |
| `opencode-local` | `crates/local` | Client-local files shared with the TypeScript client: paths, locks, `cli.json`, storage |
| `opencode-service` | `crates/service` | Finding, probing, starting and stopping the server |
| `opencode-store` | `crates/store` | The client data store, fed by the event stream |
| `opencode-plugin-abi` | `crates/plugin-abi` | The plugin contract and the SDK of native plugins |
| `opencode-ui` | `crates/ui` | The UI kit: themes, keymap, dialogs, content widgets, grammars |
| `opencode-plugin` | `crates/plugin` | The plugin host: registry, loader, carriers, the renderer of plugin trees |
| `opencode-latex`, `opencode-mermaid` | `crates/latex`, `crates/mermaid` | Two built-in plugins, on `opencode-plugin-abi` alone |
| `opencode-tui` | `crates/tui` | The full-screen TUI |
| `opencode-mini` | `crates/mini` | `mini`, the interface in the terminal's scrollback |
| `opencode-acp` | `crates/acp` | The ACP agent |
| `opencode-drive` | `crates/drive` | The simulation UI endpoint, which drives a headless TUI |
| `opencode-parity` | `crates/parity` | Cell fixtures and comparison, for tests only |
| `opencode-cli` | `crates/cli` | The `opencode-native` binary: the command line and its commands |

Third-party crates are declared once, in `[workspace.dependencies]` of the root `Cargo.toml`. OpenTUI's Rust crates
come from `anomalyco/opentui`, pinned to a release; the [README](../README.md#build) describes the pin and its native
library.

## The command line

`crates/cli` parses the command line as the TypeScript CLI does: the same commands, aliases, arguments, flags and
descriptions, the same help, completion scripts and usage errors.

- `src/args.rs` declares the command tree as a static table, and a struct of typed arguments for each command.
- `src/parse.rs` is a port of Effect CLI's lexer and parser, with its error messages.
- `src/help.rs`, `src/completions.rs` and `src/wizard.rs` print the help, the completion scripts and the wizard.
- `src/commands/` holds one module for each command. `default.rs` is the TUI.

Two fixtures hold the table to the TypeScript tree. `script/gen/commands.ts` dumps the TypeScript tree to
`crates/cli/tests/fixtures/commands.json`, and `src/tests/tree.rs` compares the table with it.
`script/gen/cli-output.ts` records what the TypeScript CLI prints for help and usage errors into
`crates/cli/tests/fixtures/cli`, and `src/tests/output.rs` compares byte for byte.

`serve`, `uninstall` and `plugin` are delegated: the client runs the TypeScript `opencode` with the same arguments,
standard streams and exit code (`crates/service/src/delegate.rs`). `plugin dev` and `plugin test` are the client's
own ([`plugin-abi.md`](plugin-abi.md#authoring-commands)).

## Talking to the server

### The API client

`script/gen/api.ts` generates the client from the server's API definition (`ClientApi` in `@opencode/protocol`), with
the options the TypeScript Promise client is generated with:

- `crates/api-types/src/types.rs`: the types;
- `crates/api-types/src/client.rs`: one request builder for each endpoint, which returns a `Call<T>` typed by what the
  endpoint answers, with no transport;
- `crates/api/src/generated/methods.rs`: one `async` method on `Client` for each endpoint, which sends the call.

A method is named by its path in the client, in snake case: `session.message.get` is `session_message_get`. Its input
is one struct that holds every path parameter, query field, header and payload field.

The types decode what a newer server sends:

- Unknown fields are ignored.
- An enum of string literals has an `Unknown(String)` variant, and a union of objects an
  `Unknown(serde_json::Value)` variant, so a value this build does not know still decodes.
- An optional field is `Option<T>`. A field that is optional and nullable is `Option<Option<T>>`, so absent and
  `null` stay distinct.
- A branded string, such as a session ID, is a newtype (`SessionID`).
- A declared error implements `TaggedError` with its tag.

`crates/api/src/client.rs` is the request core: the base URL, authentication, per-call headers and declared errors.
`transport.rs` has the `Transport` trait and its `reqwest` implementation. `memory.rs` is a transport that serves
recorded responses and events from memory, which the tests use in place of a server.

### Events and sockets

- `events.rs` subscribes to `/api/event` and keeps the connection. The stream must start with `server.connected`. A
  stream that goes silent is replaced, a disconnect reconnects, and events reach the consumer in small batches with
  adjacent deltas merged. The batch queue is bounded: when it is full the loop drops the stream and reconnects, and
  the consumer resynchronizes on the next `server.connected`.
- `sse.rs` is the server-sent events reader.
- `ws.rs` opens WebSockets, with a ticket where the socket needs one. `pty.rs` is the persistent terminal socket and
  `client_mcp.rs` the socket on which the client serves MCP tools to the server.

### Finding and starting a server

`crates/service` resolves the server a command talks to (`connect::resolve`):

1. `--server <url>` names it.
2. `--standalone`, or a service config with `disabled: true`, starts a standalone server: a private TypeScript server
   for this client alone, with a random password. Its standard input is the lease: the server exits when the client
   does.
3. Otherwise discovery reads the service registrations in the state directory and probes them
   (`discover.rs`, `probe.rs`). The first ready, compatible service wins.
4. Otherwise `ensure` starts the background service and waits for it.

The rules of `ensure` (`ensure.rs`):

- **It starts a service only when none runs.** A service that is starting is waited for.
- **It never stops a service it did not start,** with one exception. A service of another version than the client's,
  registered in the client's own channel, is restarted when the command asks for it: the TUI and `mini` do, as the
  TypeScript ones do, and say `Restarting background server (version mismatch)...`. Its terminals are handed over
  (`handoff.rs`). `--server` only warns.
  [`parity/deviations/S03-never-replace.md`](../parity/deviations/S03-never-replace.md) has the differences from the
  TypeScript client.
- **An unresponsive service is left running.** A registered service that does not answer three probes in a row fails
  the command with a message that names it. A registration whose process is gone is evicted.
- **What it runs** is the TypeScript binary (`ts_command.rs`): `OPENCODE_TS_BIN`, else the `opencode` installed
  beside the client, else `opencode` on `PATH`. The service is `<opencode> serve --service`, and the standalone
  server `<opencode> serve --stdio --port 0`.
- **Contenders.** A start is a detached process (`spawn.rs`, `contender.rs`). At most two are alive, a startup
  failure is kept and reported once none is left, and clean exits back off.

A restarted service may register a new port or password. `follow.rs` makes one client follow it: a request that
fails to connect, or is refused with 401, finds the service again before it returns its error. The request is not
retried, so a request that may have reached the old service is never sent twice.

`stop.rs` stops a service for the explicit `service stop`, `restart` and `set` commands.

## Client-local files

`crates/local` reads and writes the files the client shares with the TypeScript client. Both use the same paths, the
same lock and the same atomic writes, so they run side by side.

| File | Module | Notes |
| --- | --- | --- |
| Paths | `paths.rs`, `channel.rs` | The XDG roots, `OPENCODE_CONFIG_DIR`, and the channel that picks the registration and storage files |
| The lock | `lock.rs` | A directory lock compatible with the TypeScript `Flock` |
| `cli.json` | `cli_config.rs`, `jsonc.rs`, `migrate.rs` | Decoding is strict: a wrong type anywhere fails the document, which then reads as `{}`. Unknown keys are dropped |
| TUI storage | `storage.rs` | `<state>/<channel>/tui/<key>.json`. Values stay `serde_json::Value`, so fields the other client wrote survive a write |
| Prompt history, stash, frecency | `jsonl.rs` | JSONL files in the state directory |
| `model.json` | `model_pref.rs` | Recent and favorite models, and variants |
| Pinned sessions | `pins.rs` | `<state>/session.json` |
| Service registration and config | `registration.rs`, `service_config.rs` | `service.json`, or `service-<channel>.json` |

`jsonc.rs` is a port of the parts of `jsonc-parser` the TypeScript client uses. An update of `cli.json` edits the
text in place and keeps the user's comments and formatting, byte for byte as the TypeScript client would write it.
That is why the port exists: another JSONC library formats its edits differently.

`watch.rs` watches a directory for live reload, with a 50 ms debounce. `OPENCODE_FILEWATCHER_DISABLE` (or
`OPENCODE_DISABLE_FILEWATCHER`) set to `1` or `true` turns every watch off. `serial.rs` is a worker thread that runs
blocking file jobs in order, so a write that waits on a file lock stays off the UI thread.

## The store

`crates/store` is the client's copy of the server's state: sessions and their families, status, messages and their
parts, pending inbox items, permissions, forms, projects, shells and locations. It ports `createData` of the
TypeScript client.

- **`Data`** is a cheap `Clone` handle around one locked `State`. The UI thread reads it with
  `data.read(|state| …)`. The lock is never held across an `.await`. A store action may not run inside a read.
- **Requests** run on the tokio runtime the store was created with, so the handle works from the UI thread. A read
  that several callers ask for is one shared load.
- **Events.** `connection.rs` applies each batch of the event stream under one flush, and reads again what a batch
  leaves stale. When the connection is lost, cached reads are invalidated, and `server.connected` rehydrates.
- **Change tracking** (`changes.rs`). Every mutation records what it touched in a `Changes`: the session list, a
  session's info, status, message list, single messages, pending items, permissions, forms, projects and locations.
  A flush gives the changes a revision, keeps the last 256 flushes, and sends the revision on a watch channel. A view
  keeps the revision it last rendered and asks `changes_since(seen)`. It gets the union of the newer flushes, or
  `Changes::everything()` when its revision fell out of the log. So many views observe independently, and nothing is
  unbounded.

## The UI kit

`crates/ui` holds what the TUI and its dialogs are built from, on OpenTUI.

- **Themes** (`theme/`): the built-in, custom and `system` themes, resolved into semantic tokens. The built-in themes
  come from `theme/generated/themes.json`, which `script/gen/themes.ts` writes from the TypeScript sources.
- **Keymap** (`keymap/`): `TuiKeymap` is the TUI's keymap layer on `opentui::keymap`. It takes layers of commands,
  keeps the input mode stack, runs the timed leader key, and formats shortcuts. `Keybinds::resolve` resolves the
  `keybinds` object of `cli.json` over the generated defaults (`keymap/generated.rs`, written by
  `script/gen/keybinds.ts` from the TypeScript definitions).
- **Dialogs** (`dialog.rs`, `select.rs`, `prompt.rs`, `confirm.rs`, `alert.rs`, `toast.rs`, `palette.rs`): the dialog
  stack, the dialog kinds, the toasts and the command palette.
- **Content** (`markdown.rs`, `code.rs`, `diff.rs`, `prompt_input/`): the Markdown, code and diff views, and the
  prompt's editor.
- **Grammars** (`grammars/`): the tree-sitter grammars, linked statically, with the highlight queries the TypeScript
  TUI uses. `script/gen/grammars.ts` writes the queries to `assets/queries/`. The cargo feature `grammars`, on by
  default, adds the grammars beyond the ones OpenTUI links. Kotlin, OCaml, F# and Swift are not linked
  ([`parity/deviations/H06-highlight-queries.md`](../parity/deviations/H06-highlight-queries.md)).

## The TUI

`crates/tui` is the full-screen TUI. `app::run` runs it on the terminal, and `app::mount` builds it on any `App`,
including a test's.

### Threads

- **The UI thread** runs the app and owns every widget. OpenTUI's handles are not `Send`.
- **Network work** runs on the app's tokio runtime. `Tui::request` runs a request there and hands its result back to
  the UI thread.
- **Blocking file work** (`cli.json`, storage, `model.json`) runs on worker threads, because the file lock blocks.
- **The store wakes the UI** through one bounded path. One task forwards the store's flushes, its signals and the
  connection's status to the UI thread (`pump` in `app.rs`). A flush posts a `DataChanged` message only when none is
  pending, so at most one wake is queued, however fast the store flushes.

Every queue between a task and the UI is bounded.

### The shared context

`app::Tui` is the one shared context, held as `Rc<Tui>`. It holds the app, the store (`data`), the keymap, the dialog
stack, the toasts, the theme, the configuration, the plugin registry, the tabs, the frame and the current route with
its mounted view. Widget callbacks keep a `Weak<Tui>`, so the app does not leak through them.

### Routes and views

`routes::Route` is `Home`, `Session { id }` or `Plugin { id, name }`. A mounted route implements `RouteView`:

```rust
pub trait RouteView {
    fn root(&self) -> View;
    fn sync(&self, tui: &Tui, changes: &Changes);
    fn focus_target(&self) -> Option<AnyWidget> { None }
    fn restyle(&self, _tui: &Tui) -> bool { false }
}
```

`Tui::navigate(route)` detaches the current view, mounts the new one, and syncs it once with
`Changes::everything()`. After that, each wake from the store calls `data.changes_since(seen)` once and passes the
result to the view. A view updates only the widgets the changes name. A part of a view, such as the transcript, the
permission prompt or the sidebar, has the same `sync` shape and is called by its view. An open dialog follows the
store the same way, through `Tui::follow`.

`restyle` takes a new theme in place, so the widgets keep their state. A view that returns `false` is mounted again.

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
vertical rail needs room for itself and the session; otherwise the strip is horizontal.

The session route's view (`routes/session/`) is a column inside `frame::SessionFrame`:

```text
session frame (row)
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

A panel shows beside the session, or over the whole screen when the room is too narrow to split or the plugin asks.
Full screen hides the session pane and the tabs. The rail's and the pane's widths are kept in the `layout` storage
key.

### Keys

There is one keymap, built from the resolved `keybinds`. `app.rs` sends every key to it before any widget
(`route_keys`): the keymap's focus is set from the focused widget and its ancestors, and a key the keymap handles
stops there. Commands register in layers. A global layer holds the commands the palette reaches, and separate layers
bind the keys. `Ctrl+C` reaches the keymap rather than ending the app, so an open dialog closes first. Plugins' keys
go through the same keymap ([`plugin-abi.md`](plugin-abi.md#panels-overlays-and-input)).

### Theme

`ThemeState` starts from `cli.json`'s `theme`, the terminal's mode and the terminal's palette. A theme change is
applied to the dialogs, the toasts and the mounted view, which restyles in place or mounts again. Changes of the name
and the mode are written to `cli.json` on a worker thread.

### Modules

| Module | Contents |
| --- | --- |
| `app.rs` | The shared context, mount, the wake path, the app-wide keys |
| `routes/` | Home, the session route (transcript, tools, permission, forms, sidebar), a plugin's route |
| `frame/`, `tabs/`, `panel/` | The shell, the session frame and pane resizing; session tabs; plugin side panels |
| `prompt/` | The prompt: editor, autocomplete, history, stash, attachments, submit |
| `composer/`, `terminal/` | The composer tabs under the transcript; terminal panes |
| `dialogs/` | One module for each dialog |
| `features/` | App-wide features that are not a route: startup, events, title, attention, links |
| `plugins/` | The TUI's side of the plugin host, and the built-in plugins |
| `local.rs` | The model and agent selection |
| `client_mcp/` | The tools the TUI serves to the server |

## Plugins

Everything a plugin does goes through one contract, `crates/plugin-abi`, and the built-ins use it too.
[`plugins.md`](plugins.md) explains the model and [`plugin-abi.md`](plugin-abi.md) is the reference.

Two built-ins are crates of their own, so that the TUI does not rebuild when they change:

- **`opencode-latex`** (`opencode.latex`) draws `latex`, `math` and `tex` fences as Unicode math in terminal cells,
  and Markdown math (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`). It is a port of `packages/latex`, with the layout of
  opentui-tex. No Rust crate lays out math in terminal cells, and the tests compare cells with the TypeScript
  client's, so the parser, the layout and the symbol tables are ported rather than taken from a library.
  [`parity/deviations/P2-latex-inline.md`](../parity/deviations/P2-latex-inline.md) and
  [`P2-latex-opentui-tex.md`](../parity/deviations/P2-latex-opentui-tex.md) list where it draws differently.
- **`opencode-mermaid`** (`opencode.merman`) draws `mermaid` fences: flowcharts, sequence, state, gantt, gitgraph and
  timeline diagrams. It is a port of `packages/merman`, one Rust module for each TypeScript module, for the same
  reason: the Rust crates that draw Mermaid as text have layouts of their own, and the streaming fallback depends on
  the TypeScript parser's errors.

## `mini`, ACP and the simulation endpoint

- **`opencode-mini`** is `mini`: the app lives in a footer at the bottom of the main screen, and the session's
  transcript is written to the terminal's scrollback above it.
- **`opencode-acp`** is `opencode-native acp`: the Agent Client Protocol over JSON-RPC on standard input and output.
  The agent starts a standalone server and talks to it over HTTP.
- **`opencode-drive`** is the simulation UI endpoint (`OPENCODE_DRIVE`): a WebSocket server that drives a headless TUI
  with keys and mouse events and captures its screen. The parity harness uses it
  ([`testing.md`](testing.md#p-tui-the-simulated-server)).

## Generated files

Generated files are committed. `bun run generate` runs every generator in `script/gen/`, in name order, and each
writes its own output under `crates/` or `assets/`:

| Generator | Writes |
| --- | --- |
| `api.ts` | The API types, request builders and methods; the operations table of the Luau client |
| `commands.ts`, `cli-output.ts` | The CLI's command tree and its help and usage-error goldens |
| `config.ts`, `keybinds.ts` | The keybind names of `cli.json`, and each name's default and description |
| `themes.ts` | The built-in themes |
| `grammars.ts` | The highlight queries |
| `plugin-schema.ts`, `plugin-types-luau.ts` | The plugin contract's JSON Schema, and the Luau type stub from it |
| `js-host.ts` | `compat.js`, the JS host's compatibility layer |
| `accents.ts`, `entities.ts`, `mime.ts`, `structured-patch.ts`, `time.ts` | Tables and known-answer cases taken from the TypeScript client's libraries |

`bun run check:drift` runs the generators and the fixture oracles again and fails when a committed file changes
([`testing.md`](testing.md#generated-files-and-drift)).
