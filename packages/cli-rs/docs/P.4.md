# P.4 external plugins (`rs-plugin-loader`)

Row F16. External TUI plugins are native shared libraries behind a stable C ABI (decision O-42, which replaces the
WASM design of O-7 and O-40). The host opens them with `opencode_util::dl` (`dlopen`, `LoadLibraryW` on Windows), so
they load on Linux (`.so`), macOS (`.dylib`) and Windows (`.dll`). There is no sandbox: a plugin is code the user
chose to run on their own machine. No cargo feature gates it.

To write one, start with the quick start in [`crates/plugin-abi/README.md`](../crates/plugin-abi/README.md). It also
lists which old binaries load and what changed from the 1.3 and 1.4 SDKs. This document is the reference.

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
| `describe(&out)` | 1.1 | Optional (nullable): the plugin's ID and version, read before any setup |

The host passes a `HostApi` table of the same shape: `size`, `major`, `minor`, `ctx`, `call`, `free`, since 1.2 the
nullable `theme_mode(ctx)` (dark or light), and since 1.3 the nullable `wake(ctx)`, callable from any thread until
`destroy` returns. Past the tables, everything crosses as JSON in byte buffers: the `Manifest`, a `Request` from the
host, and a `HostRequest` from the plugin. Each side frees the buffers it allocated, so each keeps its own allocator.
The rustdoc of `Request` and `HostRequest` lists every request and what it answers; a plugin in another language
implements the same structs and JSON.

Versions only grow by appending:

- A new entry goes at the end of a table and is optional. A reader treats entries past the other side's `size` as
  absent, so a plugin built against ABI 1.0 loads on a 1.5 host.
- JSON payloads only gain optional fields; readers ignore fields they do not know.
- A plugin built against a newer minor version loads on an older host and uses what the host offers: the host
  answers a request it does not know with an error. A plugin that cannot work without a newer host sets
  `requires_minor`, and the host refuses it: "plugin needs host ABI 1.4 or newer, this opencode-native has 1.3; update
  opencode-native". `export_plugin!` sets `requires_minor` to 4, because only a 1.4 host sends the render requests the
  SDK answers; `export_plugin!(id, setup, requires_minor = 5)` asks for a newer host, and `Read::abi_minor()` reads the
  host's minor. So a 1.5 plugin loads on a 1.4 host, which answers the 1.5 requests with an error: there `composer()`
  reads `None`, and an `edit_composer`, a `Confirm` and an `Alert` do nothing. A 1.4 host draws a 1.5 box without its
  1.5 properties, which it does not read.
- 1.4 renders are opt-in on the wire. `Setup` sets `Manifest::render` to 2 (`RENDER`), and a 1.4 claim sets
  `SlotClaim::render`. The host sends `RenderFence`, `Render` and `RenderRoute` only to such a plugin and claim; every
  other plugin, and a `slot_lines` claim or `route_lines` route, gets the 1.3 requests `Fence`, `Slot` and `Route`,
  and answers with rows.
- 1.5 adds data, not tables: the dialogs `Confirm` and `Alert`, the box properties (`Border`, `padding_sides`, `wrap`,
  `overflow`, and `Layout`'s `height`, `min_height`, `max_height` and `margin`), and the composer's `HostRequest::Composer`
  and `HostRequest::ComposerEdit`. Each new field is left out of the JSON while unset, so 1.4 JSON reads as before and
  a 1.4 plugin's requests are unchanged.
- Only a deliberate major-version break refuses a plugin. The host reads `major` before anything else, and the
  plugin manager shows why: "plugin ABI 2.0 is not supported: this opencode-native loads ABI 1.x plugins (up to 1.5);
  rebuild the plugin against opencode-plugin-abi 1".

A Rust-ABI `dylib` was rejected because it breaks with every compiler or crate version.

## Writing a plugin

A Rust plugin is a `cdylib` that calls `export_plugin!("my.plugin", setup)`, with `fn setup(setup: &mut Setup) ->
Result<(), String>`. The macro generates the table, `describe` (the ID and the crate's version) and the shims. Setup
registers the P.1 surface as data, because widgets and closures cannot cross the boundary:

| P.1 (TS `api.*`) | ABI (`opencode_plugin_abi::Setup`) |
| --- | --- |
| `layer` (commands, palette, slash, keybinds) | `command(Command, run(&dyn Host, input))`; the host builds the keymap layer. A command without `palette` and `slash` is hidden: a click or `Host::dispatch` runs it |
| `code_block(language, render)` | `code_block(language, render(&dyn Read, &Fence) -> Fenced)` |
| `slot(placement, render)` | `slot(Placement, render(&dyn Read, &SlotInput, &Changed) -> Render)`; the 1.3 form is `slot_lines(SlotKind, path, render(session_id) -> Vec<Line>)` |
| a slot component's lifetime | `on_mount(Placement, run(&dyn Host, &SlotInput, mounted))` for the claim registered last there: `true` before a mount's first render, `false` as it unmounts |
| `route(name, render)` | `route(name, render(&dyn Read, &Changed) -> Render)`, drawn centered in a scroll box on the page background; the 1.3 form is `route_lines(name, render() -> Vec<Line>)` |
| a route page's `onMount` | `on_route_mount(name, run(&dyn Host, mounted))`, however the route was opened |
| `storage_key(key)` | `storage_key(key)`; `Read::storage_get`, `Host::storage_set` and `Host::storage_merge` on `plugin.<id>.<key>` |
| event subscriptions (`api.event.on`) | `on_event(types, run(&dyn Host, &V2Event))`, with the HTTP API's own event |
| `api.client` | `Host::fetch(Fetch { method, path, query, body }) -> RequestId` and `on_reply(run(&dyn Host, RequestId, Result<Value, String>))` |
| a timer's tick | `Setup::waker()` on the plugin's thread, and `on_wake(run(&dyn Host))` on the UI thread |
| a fence's cleanup | `on_fence_gone(run(key))` |
| `on_dispose` | `on_dispose(run(&dyn Host))` |
| `api.themeMode` | `Read::theme_mode()` |
| the composer (`renderer.currentFocusedEditor`, the composer's `ref`) | `Read::composer()` and `Host::edit_composer(ComposerEdit)` (1.5) |

`Setup::options()` holds the `options` of the plugin's `plugins` entry as JSON text. `Setup::host()` is the host
while setup runs; no callback can keep it (a compile error).

A `Line` is a list of spans with text, colors, and bold, italic, underline, dim and strikethrough. A color is a theme
token path (`text.muted`, `markdown.heading`), a scale step (`categorical.3.300`), `#rrggbb`, or an `Rgba`, sent as
`#rrggbbaa`, so plugins follow the theme; `Read::color(token)` resolves one to an `Rgba`. The host draws rows without
wrapping. A fence returns `Fenced::{Code, Keep, Lines { lines, fg, drag }}`, with `Fence::key` naming the block across
renders and `Fence::width` the terminal's columns. `fg` is the default for spans without one. `Lines` scrolls
sideways on a horizontal wheel, as LaTeX's formulas do; with `drag` it scrolls under a left drag and swallows a
horizontal wheel, as Mermaid's diagrams do.

A slot render returns `Render::{Keep, Hide, Show(Node)}`. A `Node` is a `Box` (a column or a row, with gap, padding,
justification, alignment and background, and since 1.5 a `Border`, padding per side, wrapping children and overflow)
or a `Text` of spans (with wrapping, truncation and a hover color), each with a `Layout` (width, grow, shrink, minimum
width 0, and since 1.5 a height with a minimum and a maximum, and margins) and an optional `Click`: on the press or the release of the
left button, the host shows the hand and, once the event is handled, runs the click's `Action::Command { name, input
}`, a command of the plugin's or of the host's (such as `mcp.list` with a server's name, or the hidden
`workspace.directory` with a directory). `Markdown { text }` draws Markdown with the active fence renderers, and
`Spinner { label }` a spinner. A `Slot { path }` node mounts the claims of a published slot inside the claim's own
(such as `home.footer.status` in `home.footer`) in its place; the host draws nothing for any other path. The nested
claims stay mounted while the outer claim keeps its node, and get each change batch it gets.

The slots the TUI mounts, and what their `SlotInput` carries:

| Path | Where | Input |
| --- | --- | --- |
| `home.footer`, `home.footer.status` | the home screen's footer, and its status part | none |
| `prompt.footer`, `prompt.footer.status`, `prompt.footer.file` | the prompt's footer row | the session, if any, and `prompt { shell, show_details }` |
| `session.composer.top` | above the session's prompt | the session |
| `sidebar.content`, `sidebar.footer` | the session sidebar, while it shows | the session |
| `app` | under the route, on every route | none |

`session.panel` is a published path, but the TUI mounts no slot there (neither does TS), so claims on it draw nothing.
`SlotKind` places a claim `before` or `after` the slot, or `prepend`s or `append`s it inside, in plugin order; a
`replace` claim replaces the slot's content and suppresses every claim inside it, and the last one per path wins. Another claim on
a child path that is not mounted is appended to the nearest mounted ancestor. A slot mounts its claims again when its
input changes.

### What a callback may do

Every call into a plugin runs on the UI thread, so a callback must return quickly. `HostApi::call` and
`HostApi::theme_mode` serve that thread only: a call from another thread is refused with `ERROR` (and the theme reads
dark), and touches nothing of the host; a plugin's own thread calls `wake`.

- A render (a fence, a slot claim or a route) gets a `Read`. It reads and returns a value, and has no effects. Reads
  are pure, also inside the `messages` visitor: a catalog that is not loaded reads as `None`, the host starts the
  load once the outermost plugin callback has returned, and the claim renders again with the location in
  `Changed::locations`. The reads are `session`, `family`, `messages`, `models`, `mcp_servers`, `integrations` and
  `vcs` per location, `model`, `limits`, `providers`, `info` (the version, the terminal size, where the TUI works,
  how many plugins failed), `route`, `interactive` (whether the session pane owns the input, TS `useInteractivity`),
  `shortcut(name)` (a command's first key), `dialog_open(key)`, `composer` (1.5), `storage_get`, `color` and
  `theme_mode`. Over the ABI
  each read is one `HostRequest`, and `messages` hands the visitor the plugin's own copy.
- Setup, a command, and the handlers of events, replies, mounts, route mounts, wakes and disposal get a `Host`: the
  reads, and effects. Effects wait until the outermost plugin callback returns and then run in the order they were
  asked for, on the same queue as the built-ins' effects, so a plugin never reenters itself through the host. The
  host runs that queue before it routes its next message, so a store signal never overtakes an effect asked for
  while the one before it was handled. Over the ABI, a request into a plugin that is already running is dropped and
  logged; during a render request of 1.4 on (`RenderFence`, `Render`, `RenderRoute`) every effect request is refused
  with an error, and a result the host cannot decode leaves no effect and puts back the storage it wrote. What a
  dispose callback that panics asked for is dropped (1.5 `Checkpoint` and `Rollback`, which the SDK sends around
  each); the other callbacks keep theirs.
- The effects: `storage_set` and `storage_merge`; `dispatch(name, input)`, which runs any registered command, palette
  or not; `toast(Toast { variant, title, message, session })`, which with a `session` offers "Open" unless that
  session's family is on screen (a toast without a title takes the session's); `attention(Attention { title, message,
  notify, sound })`, a notification and a sound as the user's `attention` settings allow; `open_route(name)` and
  `navigate(Route)` (home, a session, or a plugin's route); `dialog(Dialog)`; `copy(text, then)`, which copies and
  runs `then` once copied; `edit_composer(ComposerEdit)` (1.5); and `fetch`.
- A `Dialog` is a `Prompt`, whose text goes to its action as the input; a `Select { title, placeholder, options,
  current, action }` (TS `dialog.select`), whose pick closes it and goes to its action as the input; a `Panel { key,
  size, title, subtitle, body, actions, binds, bleed, centered }`, which changes in place while its key is open and
  keeps where its body is scrolled; or `Close { key }`, which closes that panel. Since 1.5 it may also be a `Confirm
  { title, message, label, action }` (TS `dialog.confirm`): `Confirm` runs the action with the input `true`, `Cancel`
  and escape with `false`, and a dialog that replaces it runs nothing, as TS resolves `true`, `false` or `undefined`;
  or an `Alert { title, message, action }` (TS `dialog.alert`), whose action runs once after it closes, by enter,
  escape, or another dialog, as TS resolves its promise in each case. Every dialog of a plugin belongs to the
  activation that showed it: it closes when that activation ends (disable, failure, a reload that passed), and an
  answer reaches nobody once the activation is not live, not even a command of the host or another plugin that the
  action names. A reload that fails keeps the running activation and its dialog.
- The composer (1.5): `composer()` reads the composer on screen, on home or in a session: its text as it shows it (a
  compact paste is its label), the cursor as a byte offset into that text, and whether it has focus; `None` without a
  composer, and while a session hides it for a permission, a form, a missing location or the drawer, where TS
  unmounts it. `edit_composer` takes `Set { text }` (TS `ref.set`: the text and its attachments are replaced, the cursor
  goes to the end, the mode stays), `Insert { text }` (at the cursor, in place of a selection, as typing it does) and
  `Submit` (as enter does, with or without focus; TS `ref.submit`), which does nothing while a home form disables the
  composer or another pane has the input, as TS's `submit` refuses a disabled prompt. Behind an ordinary dialog the
  composer shows, so a submit sends and the dialog stays open. A set tells the completion of the new text, as TS's
  `setText` does. The edits go through the composer's own edit path, and like every effect they wait for the call to
  return, so a call that panics edits nothing.
- A command of `Scope::Route(name)` runs while that route shows (`/stats`' escape); `description` and `arguments`
  (the slash command keeps its text and passes it as the input) show in the palette and the prompt.

### When claims render

A claim's first render gets `Changed::all`. After that, a mounted claim or route renders again:

- with each change batch of the store: `sessions` whose info or status changed, `lists` whose message list changed,
  `messages` that changed in place, and `locations` whose catalogs changed;
- with `local` when the host's own state changes: the selected model, the usage limits, the settings, the plugins'
  storage (also another client's write), or the count of failed plugins;
- with `size` on a resize, and with `all` when `interactive` changes;
- with `woken` after each of the plugin's commands and its event, reply, mount, route-mount and wake handlers
  (queued after their effects, and coalesced), so a handler's change shows without a wake; and after a wake.

The host rebuilds a claim's widgets only when its node differs from the last one; `Keep` keeps them, so a render that
`Changed` shows is unaffected returns at once.

### Storage

`storage_key(key)` declares a key; only declared keys read and write, as `plugin.<id>.<key>` in the TUI's storage.
Declared in setup, a key works in setup too. A value is an object or an array; the host ignores any other value. A
write shows to `storage_get` at once; the host writes the disk later, in order, and renders the claims with `local`.
`storage_merge(key, fields)` sets fields in the latest stored object under the storage lock and keeps the others, so
fields another client stored stay (TS `update((draft) => …)`). On an older host it falls back to read, merge and
`storage_set`. Writes queued when the TUI exits reach the disk before it does.

### Fetch

`fetch` sends a request through the host's own client, with its credentials, to the server the TUI talks to now (a
managed service it follows across restarts). The path starts with `/` and stays on that server: a path that would
reach another origin, such as `/https://elsewhere/`, is refused before the credentials go on. The reply comes back to
the `on_reply` handlers on the UI thread, in order with the other effects, unless the plugin was disposed first. It
is the JSON body of any 2xx status, or `null` without a body. An error is text: a declared server error's message
(else its tag), `UnexpectedStatus: 404: <body>` for another error status (the body trimmed and cut at 200
characters; `UnexpectedStatus: 404` without one), `Transport: …` when the request could not be sent or would leave the
origin, or `MalformedResponse: …` when the body is not JSON. A fetch asked for by a failed setup or by a dispose
callback is not sent.

### Events

`on_event(types, run)` gets the server events of those types, after the store applied their batch, while the plugin
is active. The streaming deltas (`session.text.delta`, `session.reasoning.delta`, `session.tool.input.delta`,
`session.compaction.delta`) never arrive. If the UI thread falls more than 1024 events behind, the oldest are
skipped.

### Fences

`Fence::key` names a block while it changes, across renders that return `Lines` or `Keep`, so a plugin can keep
state for it. `on_fence_gone(run)` gets each key once, after the block whose output (`Lines` or `Keep`) showed goes or
falls back to the code view, on the UI thread after the event that freed it. A block that only ever returned `Code`
sends nothing. The host sends `FenceGone` only to a plugin that registered a handler.

### Threads and the waker

Slow work, such as a timer or network I/O, runs on the plugin's own thread, which calls `Waker::wake` (from
`Setup::waker()`; `None` from a host older than 1.3) when it has something to show. A wake is a redraw hint, not a
message. The host posts it to the UI thread; wakes before it handles one count once, and the last is never lost,
even when the queue is full. On the UI thread the host runs the plugin's `on_wake` handlers, then renders its mounted
claims and routes with `woken`; a render shows every result that is ready, not one per wake. `Waker` is `Clone` and
`Send`. Disposing the plugin revokes every clone before the `on_dispose` callbacks run: it waits for wakes in
progress, and a later wake does nothing. Stop the threads in `on_dispose`, or when the plugin's state drops (the
sample's `Ticker`).

## Discovery and configuration

The same targets as TS (`plugin/discovery.ts`, `plugin/context.tsx` reconcile):

1. Every subdirectory (or symlink to one) of the `plugins` directories: the global config directory's
   (`~/.config/opencode/plugins`, or `$OPENCODE_CONFIG_DIR/plugins`), then each `.opencode/plugins` from the project
   root (the nearest directory with `.git` or `.hg`) down to the working directory.
2. Each entry of `plugins` in `cli.json` (in the global config directory) that names no built-in: a string, or `{
   "package": …, "options": { … } }`. A local path is absolute, starts with `./` or `../` (from the config
   directory), or is a `file://` URL; `~` is not expanded. An entry that starts with `-` disables the plugins it
   names, by ID; `*` and `prefix.*` select several.

Targets merge by local path; a later entry replaces an earlier one in its place. A target has a native build when it
is a shared library, or a directory with `plugin.so` (`plugin.dylib`, `plugin.dll`). Every other target is a TypeScript plugin and
is listed as skipped (F16). Server-side TUI plugins (`GET /api/plugin` with `features.tui`) are TypeScript packages
and are not loaded. The `plugins` entries after a plugin's own entry (all of them, for a discovered plugin) decide
whether it starts enabled. A toggle in `/plugins` lasts until the TUI exits, also across hot reloads; it is not
saved, as in TS.

## Lifecycle

- Loading a build reads its ID from `describe` and runs no setup. Setup (`create`) runs on each activation, and
  deactivation, unloading, a reload and the TUI's exit destroy that instance, so a plugin that `cli.json` disables
  starts nothing. A plugin without `describe` (ABI 1.0) tells its ID only from setup, so its setup runs once at load
  and that instance is destroyed at once; what it asks for, including storage writes, is dropped.
- Destroying an instance revokes its waker, then runs its `on_dispose` callbacks, last registered first, each even when
  another panics, while the host is still valid. Their effects run, except a fetch, which is not sent, and a dialog,
  which belongs to an activation that is no longer live and shows nowhere.
- An instance whose call panicked is never destroyed, however it goes: on deactivation, unload, reload, exit, or when
  the host drops the registry. Its `on_dispose` callbacks never run, since a failed plugin is called no more; the
  instance is kept, as its library is.
- A setup that returns `Err` or panics runs the `on_dispose` callbacks it registered, and the plugin is `failed`
  and inactive, with a toast. Enabling it in the plugin manager runs setup again.
- `Loader::reconcile` loads new and changed builds (by content digest), unloads removed ones, and remounts the route
  when anything changed. A new build of an active plugin starts before the active one stops. When it fails to load
  or its setup fails, the running version keeps running and the plugin reports `… (previous version still active)`,
  as TS does. A failed build of an inactive or panicked plugin replaces its error, and enabling it fails the same way.
- A build whose ID another external plugin has is refused ("plugin ID … is already registered") and loads once that
  ID is free.
- An external plugin with a built-in's ID replaces the built-in in its place, as TS's reconcile does
  (`session-usage`, ID `opencode.sidebar.limit`, replaces the built-in usage section, between the context and MCP
  sections); unloading it brings the built-in back there, enabled or failed as it was. `ctrl+a` in `/plugins` shows
  the built-ins' IDs.
- A plugin keeps its place among the claims, and its fence precedence, across a reload and a toggle.
- Each build is copied to a file of its own before it is opened, because the platform loader returns a library
  already open at the same path, and build tools often write a new build over the old one. Libraries are never
  unloaded: a running plugin's code must outlive every pointer into it, so a reload leaks one mapping.
- Hot reload: the TUI watches `Loader::watch_dirs` (the `plugins` directories, each plugin directory, and the
  directory of each configured library) with `opencode_local::watch` and a 100 ms debounce (TS `context.tsx`), and
  reconciles on change. `OPENCODE_FILEWATCHER_DISABLE` turns it off (L09).

## Failures

- The shims catch the plugin's panics, and the host's callbacks catch the host's, so no panic unwinds across the
  boundary. The shims also silence the plugin's own panic hook, which would print over the TUI. A plugin must keep
  `panic = "unwind"`.
- A panic fails the plugin: it is not called again, its commands leave the keymap, its fences (also the ones already
  drawn) fall back to the code view, and its slots and routes draw empty. It stays active, so the plugin manager can
  disable it; enabling it again starts a fresh instance.
- Every failure (a load, a setup, a panic) shows in `/plugins` as `failed` with an `x`. Space ("view error") shows
  the message on a loaded plugin's row, where Enter toggles the plugin; Enter shows it on a target that did not load. A toast "Plugin failed: <id>" with "Run /plugins to view details." offers "Open plugins"; it names
  the target when no build ever described an ID. The home footer counts the failed plugins. The log
  (`~/.local/share/opencode/log/`) has each failure, and each request a plugin answered with an error.
- A crash that is not a panic, such as a segfault, ends the TUI. There is no sandbox to contain it.

## Sample and tests

`crates/plugin/examples/sample` is a small `cdylib` with its own workspace and `Cargo.lock`, so it is not a member of
the client's workspace and the other crates build as before. Its features select variants: `v2` draws differently
and `setup-fails` fails (the reload tests); `abi-1-0`, `minor-newer`, `major-2`, and `requires-future` pretend to
target other ABI versions; `abi-1-3` is a plugin on the frozen 1.3 SDK (`sample/abi-1-3`), and
`abi-1-0-wire` is that plugin behind the 1.0 table; `abi-1-4` is a plugin on the frozen 1.4 SDK (`sample/abi-1-4`),
whose types the loader's tests also use as a 1.4 host's decoder of the 1.5 sample, and `requires-1-5` asks for a 1.5
host. `p0a` adds the 1.5 probe (`src/p0a.rs`): a confirm, an alert, the
composer's read and edits, and a styled box. The tests build each variant once per test run into
`target/sample-plugin`: the loader's unit tests in `crates/plugin/src/loader/native/tests.rs`, and the TUI tests in
`crates/tui/tests/all/plugins.rs`. `crates/tui/tests/all/plugin_p0a.rs` runs the same probe linked, through the C
ABI's byte shims, and as the library, and the P-APP scenarios `P.1/p0a-dialogs` and `P.1/p0a-composer` check its
dialogs, its box and a composer edit against TS (`parity/plugins/p0a`).

`crates/plugin/examples/hello` is the README's quick start. `crates/plugin-abi/tests/sdk.rs` checks that the README
shows it as it is and that it builds on the SDK alone. The loader test
`the_quick_start_plugin_loads_from_a_plugins_directory_and_runs` installs it in a `plugins` directory, loads it, and
runs its command and its claim. `examples/author` is a larger
author's fixture (storage, an event, a fence), which `crates/tui/tests/all/ports.rs` loads into the TUI.

Three real TS TUI plugins are ported the same way, on `opencode-plugin-abi` alone: `subagents-sidebar`
(`opencode-subagents-sidebar`), `force-input` (`@mynameistito/opencode-force-input`) and `session-usage`
(`opencode-session-usage`). `crates/tui/tests/all/ports.rs` builds each into `target/sample-plugin`, loads it from a
`plugins` directory into the TUI, and checks what it draws and sends.
