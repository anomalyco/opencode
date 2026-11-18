# The plugin contract

This is the reference for the contract between `opencode-native` and its plugins: the C ABI, what a plugin registers,
what each callback may do, and how the host runs a plugin on each carrier. [`plugins.md`](plugins.md) is the guide:
start there for the model, tasks and timers, the limits, and how plugins are found, approved and reloaded. Paths are
relative to `packages/cli-rs`.

The contract is the crate `crates/plugin-abi` (`opencode-plugin-abi`), and the only crate a plugin depends on. Its
rustdoc documents every type (`cargo doc -p opencode-plugin-abi --open`), and `crates/plugin-abi/schema/v2.json` is
the JSON Schema of its messages, generated from the types. The host side is `crates/plugin`.

## The C ABI

A native plugin is a shared library: `.so` on Linux, `.dylib` on macOS, `.dll` on Windows. The host opens it with
`opencode_util::dl` (`dlopen`, and `LoadLibraryExW` on Windows). There is no sandbox: a library is code the user chose
to run, in the client's process. The boundary is C, not a Rust `dylib`, because the Rust ABI changes with every
compiler and crate version.

A plugin exports one symbol, `opencode_plugin_v2`, which returns a `#[repr(C)]` table, `PluginApi`. A plugin in Rust
gets it from the `plugin!` macro. A plugin in C uses `crates/plugin-abi/include/opencode_plugin.h`, which declares the
same tables and describes the messages (`crates/plugin/examples/c` is one).

| Entry | Purpose |
| --- | --- |
| `size`, `major`, `minor` | Read first, before anything else |
| `requires_minor` | The oldest host minor version the plugin works with |
| `create(host, options, &instance, &out)` | Runs the setup; writes the manifest JSON |
| `call(instance, request, &out)` | Handles a request; writes the result JSON |
| `destroy(instance)`, `free(buffer)` | Ends an instance (optional); frees a buffer the plugin wrote |
| `describe(&out)` | The plugin's ID and version, read before any setup |

The host passes a `HostApi` table of the same shape: `size`, `major`, `minor`, `ctx`, `call`, `free`, and the
nullable `theme_mode(ctx)` (dark or light), `wake(ctx)`, `send(ctx, key, message)`, `report(ctx, message)`,
`stopped(ctx)` and `features`. `wake`, `send`, `report` and `stopped` are callable from any thread until `destroy`
returns.

Past the tables, everything crosses as JSON in byte buffers: the `Manifest`, a `Request` from the host, and a
`HostRequest` from the plugin. Each side frees the buffers it allocated, so each keeps its own allocator. A buffer
over 256 MiB is refused unread. The rustdoc of `Request` and `HostRequest` lists every request and what it answers. A
plugin in another language implements the same structs and JSON.

What the host takes from a plugin is decoded before anything of the call applies. An answer it cannot decode (cut
short, not JSON, a node kind it does not know) fails the plugin and leaves no effect, as a panic does.

The host opens a copy of each build, because the platform loader returns a library already open at the same path, and
build tools often write a new build over the old one. On macOS the copy keeps the file's quarantine, so the system
checks it as it would the file. When the system refuses a library, the plugin manager names the file, the cause
(another team's signature, the quarantine of a download, a missing or invalid signature) and what to do.

### Versions

The ABI is 2.0. Versions only grow by appending:

- **Tables.** A table shorter than 2.0's is refused. A new entry of a later minor goes at the end of a table and is
  optional. A reader treats entries past the other side's `size` as absent, so a plugin built against 2.0 loads on a
  later host.
- **JSON.** Payloads only gain optional fields, and readers ignore fields they do not know.
- **A newer plugin on an older host.** A plugin built against a newer minor loads on an older host and uses what the
  host offers. The host answers a request it does not know with an error, and so does a library. The host sends a
  library no request newer than the minor its table states. A plugin that cannot work without a newer host asks for
  it with `plugin!(id = id, requires_minor = N, setup)`, and a host older than 2.N refuses it at load: "plugin needs
  host ABI 2.1 or newer, this opencode-native has 2.0; update opencode-native".
- **One major.** Any other major is refused, and the plugin manager shows why: "plugin ABI 3.0 is not supported: this
  opencode-native loads ABI 2.x plugins (up to 2.0); rebuild the plugin against opencode-plugin-abi 2". A library that
  exports `opencode_plugin_v1` is refused the same way, as "plugin ABI 1.x".
- **Nothing is removed** from the ABI inside a major.
- **Features.** The host states its optional features in `HostApi::features`, which a plugin reads with `Read::abi`
  (`Abi::has_feature`). A 2.0 host has three: `image-bounds` (the bounds of the images it decodes), `focus-input`
  (`Host::focus` of a field or a scroll) and `fence-node` (the host's code view of a claimed fence, `Node::Fence`). A plugin that
  needs one lists it in `Metadata::requires` (`plugin!(id = .., requires = ["feature"], setup)`), and a host without
  it refuses the plugin at load and names it. A plugin that can work without one checks for it and falls back: it
  lowers a `fence` node for a host without `fence-node` with `View::or`.

The crate's [README](../crates/plugin-abi/README.md) states what the Rust SDK promises a plugin's source.

## What setup registers

A Rust plugin is a `cdylib` that calls `plugin!(setup)` (the crate's package name is the plugin's ID) or
`plugin!(id = "my.plugin", setup)`, with `fn setup(setup: &mut Setup) -> Result<(), String>`. The macro generates the
table, `describe` (the ID and the crate's version) and the shims, and holds every `unsafe`. A plugin built with
`panic = "abort"` does not compile.

Setup registers everything as data, because widgets and closures cannot cross the boundary. The left column names
what a TypeScript plugin uses for the same thing.

| TypeScript plugin API | `opencode_plugin_abi::Setup` |
| --- | --- |
| A keymap layer's commands (palette, slash and its aliases, keybinds, `enabled`) | `command(Command, run(&dyn Host, input))`; the host builds the keymap layer. A command without `palette` and `slash` is hidden: a click or `Host::dispatch` runs it. One that is disabled (`Command::disabled`, `Host::set_enabled`) binds no key and is in neither the palette nor the slash list. A run that returns `Handled::Pass` declines the key that ran it, which goes on as if the command were not there |
| A code block renderer | `code_block(language, render(&dyn Read, &Fence) -> Fenced)` |
| A slot | `slot(Placement, render(&dyn Read, &SlotInput, &Changed) -> Render)` |
| A slot component's lifetime | `on_mount(Placement, run(&dyn Host, &SlotInput, mounted))` for the claim registered last there: `true` before a mount's first render, `false` as it unmounts |
| A route | `route(name, render(&dyn Read, &Changed) -> Render)`, drawn centered in a scroll box on the page background |
| A route page's `onMount` | `on_route_mount(name, run(&dyn Host, mounted))`, however the route was opened |
| A storage key | `storage_key(key)`; `Read::storage_get`, `Host::storage_set` and `Host::storage_merge` on `plugin.<id>.<key>` |
| Event subscriptions (`api.event.on`) | `on_event(types, run(&dyn Host, &V2Event))`, with the HTTP API's own event |
| `api.client` | `Host::try_fetch(Fetch { method, path, query, body }) -> Result<RequestId, String>` and `on_reply(run(&dyn Host, RequestId, Result<Value, String>))` |
| A timer's tick | `Setup::waker()` on the plugin's thread, and `on_wake(run(&dyn Host))` on the UI thread |
| A fence's cleanup | `on_fence_gone(run(key))` |
| The cleanup `setup` returns | `on_dispose(run(&dyn Host))` |
| `api.themeMode` | `Read::theme_mode()` |
| The composer (`renderer.currentFocusedEditor`, the composer's `ref`) | `Read::composer()` and `Host::edit_composer(ComposerEdit)` |
| `onSizeChange` and `this.width` in a slot | `sized(Placement)` for the claim registered last there: `SlotInput::width` and `height`, and a render with `Changed::size` when they change |
| `data.on("session.*.delta")` | `on_deltas(run(&dyn Host, &[V2Event]))`, at most once a frame |
| `ui.model.current`, `ui.model.variant.list/set` | `Read::model`, `Read::variants`, `Host::set_variant(Option<&str>) -> bool`, and `Host::set_model(provider, model)` |
| `ui.tabs.enabled/list/open/focus/move/close` | `Read::tabs_enabled`, `Read::tabs`, `Host::edit_tab(TabEdit) -> bool` |
| `keymap.pending/active/commands/shortcuts` | `Read::keymap_pending`, `keymap_active`, `keymap_commands`, `shortcuts(name)` |
| `renderer.getSelection()`, `clearSelection()` | `Read::selection`, `Host::clear_selection`. A plugin cannot set the range. The selection is the widgets' live state: it goes when its anchor widget goes (a transcript row scrolled out of its window, a claim whose node changed), and a key press clears it before the keymap runs |
| `renderer.suspend()`, a program, `resume()` | `Host::try_foreground(Foreground { command, args, cwd }) -> Result<RequestId, String>`; the exit code comes to `on_reply` |
| `renderer.setTerminalTitle` | `Host::set_title(title)` |
| `api.theme.selected/has/set/install` | `Read::theme`, `Read::themes`, `Host::set_theme(name) -> bool`, `Host::install_theme(name, json)` |
| `<a href>` in a text | `Span::link(url)`, an OSC 8 link |
| `dialog.set({ size: "xlarge" })` | `PanelSize::XLarge` |

`Setup::options()` holds the `options` of the plugin's `plugins` entry as JSON text. `Setup::host()` is the host
while setup runs; no callback can keep it (a compile error). `Setup::tasks()` starts tasks, the SDK's way to wait
([`plugins.md`](plugins.md#waiting-tasks-await-and-timers)).

## What a plugin draws

### Lines and colors

A `Line` is a list of spans with text, colors, bold, italic, underline, dim and strikethrough, and an OSC 8 `link`
(a terminal without OSC 8 shows the text alone). A color is a theme token path (`text.muted`, `markdown.heading`), a
scale step (`categorical.3.300`), `#rrggbb`, or an `Rgba`, sent as `#rrggbbaa`, so plugins follow the theme.
`Read::color(token)` resolves one to an `Rgba`. The host draws rows without wrapping.

### Fence renders

A fence render returns `Fenced::{Code, Keep, Lines { lines, fg, drag }}`. `Fence::key` names the block across
renders, and `Fence::width` is the terminal's columns. `fg` is the default for spans without a color. `Lines` scrolls
sideways on a horizontal wheel, as LaTeX's formulas do. With `drag` it scrolls under a left drag and swallows a
horizontal wheel, as Mermaid's diagrams do.

### Nodes

A slot or route render returns `Render::{Keep, Hide, Show(Node)}`. A `Node` is one of:

- **`Box`**: a column or a row, with gap, padding, justification, alignment and background, a `Border`, padding per
  side, wrapping children and overflow.
- **`Text`**: spans, with wrapping, truncation and a hover color.
- **`Markdown { text }`**: Markdown with the active fence renderers.
- **`Spinner { label }`**: a spinner.
- **`Slot { path }`**: the claims of a published slot, mounted inside the claim's own (such as `home.footer.status`
  in `home.footer`). The host draws nothing for any other path. The nested claims stay mounted while the outer claim
  keeps its node, and get each change batch it gets.

Each has a `Layout` (width, grow, shrink, a width and a height each with a minimum and a maximum, and margins) and an
optional `Click`. On the press or the release of the left button, the host shows the hand and, once the event is
handled, runs the click's `Action::Command { name, input }`: a command of the plugin's or of the host's, such as
`mcp.list` with a server's name, or the hidden `workspace.directory` with a directory.

A surface's view returns a tree of `v2::Node`, which has more kinds ([Surfaces](#surfaces)).

### Slots

The slots the TUI mounts, and what their `SlotInput` carries:

| Path | Where | Input |
| --- | --- | --- |
| `home.footer`, `home.footer.status` | the home screen's footer, and its status part | none |
| `prompt.footer`, `prompt.footer.status`, `prompt.footer.file` | the prompt's footer row | the session, if any, and `prompt { shell, show_details }` |
| `session.composer.top` | above the session's prompt | the session |
| `sidebar.content`, `sidebar.footer` | the session sidebar, while it shows | the session |
| `app` | under the route, on every route | none |

`session.panel` is a published path, but the TUI mounts no slot there (neither does the TypeScript TUI), so claims on
it draw nothing.

`SlotKind` places a claim `before` or `after` the slot, or `prepend`s or `append`s it inside, in plugin order. A
`replace` claim replaces the slot's content and suppresses every claim inside it, and the last one per path wins. A
replacement on an ancestor path beats one on a descendant. A claim on a child path that is not mounted is appended to
the nearest mounted ancestor. A slot mounts its claims again when its input changes. `slot::resolve` in
`crates/plugin/src/slot.rs` holds these rules.

## What a callback may do

Every call into a plugin runs on the UI thread, so a callback must return quickly. `HostApi::call` and
`HostApi::theme_mode` serve that thread only: a call from another thread is refused with `ERROR` (and the theme reads
dark), and touches nothing of the host. A plugin's own thread calls `wake`.

### Reads

A render (a fence, a slot claim or a route) gets a `Read`. It reads and returns a value, and has no effects.

- **Reads are pure,** also inside the `messages` visitor. A catalog that is not loaded reads as `None`, the host
  starts the load once the outermost plugin callback has returned, and the claim renders again with the location in
  `Changed::locations`.
- **Every read of one plugin call, in a render or a handler, sees one store snapshot.** A batch the store applies on
  another thread meanwhile waits until the call returns.
- **Over the ABI each read is one `HostRequest`,** and `messages` hands the visitor the plugin's own copy.

The reads:

| Read | What |
| --- | --- |
| `session`, `family`, `messages`, `message(session, id)` | a session, its family, its messages, one message |
| `models`, `mcp_servers`, `integrations`, `vcs` | a location's catalogs |
| `model`, `variants`, `limits`, `providers` | the model the next prompt uses, its variants, the usage limits, the providers |
| `info` | the version, the terminal size, where the TUI works, how many plugins failed, and the user's locale |
| `utc_offset(at)` | the host's zone at an instant |
| `measure(text)` | the text's cells and graphemes as the host draws them |
| `route`, `interactive` | the route, and whether the session pane owns the input |
| `shortcut(name)`, `shortcuts(name)`, `keymap_pending`, `keymap_active`, `keymap_commands` | keys as the TUI shows them |
| `dialog_open(key)` | whether the plugin's keyed dialog shows |
| `composer` | the composer on screen ([The composer](#the-composer)) |
| `storage_get` | a declared storage key |
| `color`, `theme_mode`, `theme`, `themes` | a resolved color, dark or light, the selected theme's name, and every name |
| `tabs_enabled`, `tabs` | each tab's root session, title, and whether it is on screen, busy, waits on the user or has unread activity or an error |
| `selection` | the text the mouse selected |
| `plugins` | the TUI plugins ([The plugin list](#the-plugin-list)) |
| `setting(name)` | one of the host's named settings |
| `image_size(bytes)` | the size the host's decoder gets from the bytes |
| `rect`, `focused`, `mode` | of the running call's mount ([Panels, overlays and input](#panels-overlays-and-input)) |

### Effects

Setup, a command, and the handlers of events, replies, mounts, route mounts, wakes and disposal get a `Host`: the
reads, and effects.

- **Effects wait until the outermost plugin callback returns** and then run in the order they were asked for, on the
  same queue as the built-ins' effects, so a plugin never reenters itself through the host. The host runs that queue
  before it routes its next message, so a store signal never overtakes an effect asked for while the one before it
  was handled.
- **Over the ABI,** a request into a plugin that is already running is dropped and logged. During a render request
  (`RenderFence`, `Render`, `RenderRoute`) every effect request is refused with an error, the small verbs too. A
  result the host cannot decode leaves no effect and puts back the storage it wrote.
- **What a dispose callback that panics asked for is dropped** (`Checkpoint` and `Rollback`, which the SDK sends
  around each). The other callbacks keep theirs.

The effects:

- `storage_set` and `storage_merge` ([Storage](#storage)).
- `dispatch(name, input)` runs any registered command, palette or not.
- `toast(Toast { variant, title, message, session })`. With a `session` it offers "Open" unless that session's family
  is on screen, and a toast without a title takes the session's.
- `attention(Attention { title, message, notify, sound })`: a notification and a sound as the user's `attention`
  settings allow.
- `open_route(name)` and `navigate(Route)`: home, a session, or a plugin's route.
- `dialog(Dialog)` ([Dialogs](#dialogs)).
- `copy(text, then)` copies and runs `then` once copied.
- `edit_composer(ComposerEdit)` ([The composer](#the-composer)).
- `try_fetch` ([Fetch](#fetch)) and `try_foreground` ([Foreground programs](#foreground-programs)).
- `set_model(provider, model)`, as the model dialog picks one. A model the TUI does not list is ignored.
- `clear_selection`.
- `set_title(title)`, also with `terminal.title: false`. The TUI sets its own title again with its next change, and
  clears a plugin's on exit.
- `install_theme(name, json)`, written as `<config>/themes/<name>.json`, then listed. A name that is not a plain file
  name, or a value without `theme` or `base`, is refused.

Three verbs answer at once whether they will act, as their TypeScript counterparts return a boolean, and act once the
call returns:

- `set_variant(variant)`: `false` without a model, or for a variant it lacks. `None` is the default.
- `edit_tab(TabEdit::{Open, Focus, Move, Close})`: `false` while tabs are off, for a `Move` of a tab that is not open,
  and for a `Close` with no tab matched. `Open` adds a tab without showing it, and `Focus` shows it. `Move` takes any
  session of the tab's family, `Close` the tab's own ID.
- `set_theme(name)`: `false` for a theme the TUI does not have. It saves `theme.name` as the theme dialog does.

Each answer counts what the same call did before: `set_variant` checks the model an earlier `set_model` picked,
`edit_tab` the tabs earlier edits opened and closed, and `set_theme` the themes an earlier `install_theme` installed.

A command of `Scope::Route(name)` runs while that route shows. Its `description` and `arguments` show in the palette
and the prompt, and the slash command keeps its text and passes it as the input.

### Foreground programs

`foreground` gives the terminal to a program as the TUI does for `$EDITOR`: once the call is done the TUI restores
the terminal, runs the program, waits for it, and sets the terminal up again.

- **Where it runs.** In `cwd`; else where the TUI works, when that directory exists here (a remote server's may not);
  else in the TUI's own directory.
- **The reply** to its `RequestId` is `{ "code": <exit code or null> }`, plus `"signal"` on Unix when a signal ended
  it, or the error when it did not start. Every request gets one reply.
- **One program has the terminal at a time,** shared with `$EDITOR`. A second request while one waits or runs is
  refused at once. So is a request in a headless TUI (drive mode), and one whose plugin was disabled or failed before
  the program started.
- **The program has the terminal's three standard streams,** also standard error, which the TUI otherwise captures,
  and gets the signals of the terminal's keys. The TUI gets none (`opencode_util::job`;
  [`parity/deviations/F16-plugin-foreground.md`](../parity/deviations/F16-plugin-foreground.md)).
  - Linux and macOS: the program runs in a process group of its own, which is the terminal's foreground group while
    it runs. Ctrl+C and Ctrl+\ signal it alone. Ctrl+Z stops it, and the TUI continues it at once, as it has no shell
    to hand a stopped job to. Input the program leaves unread is dropped once it exits, so it does not reach the
    composer.
  - Windows: the console sends Ctrl+C and Ctrl+Break to every process attached to it. While the program runs the TUI
    takes them and ignores them, so they end the program alone. Its standard error is `CONOUT$`, and console input it
    leaves unread is dropped.
- **A terminal mode the TUI does not know of** (a Kitty keyboard flag the program pushed, say) is not undone. The TUI
  sets up only its own modes again, and sends the title again.

### Dialogs

A `Dialog` is one of:

- **`Prompt`**: its field is filled with its `value`, under its `description`, and its text goes to its action as
  the input.
- **`Select { title, placeholder, options, current, action }`**: a pick closes it and goes to its action as the
  input. With a `key` it is the rich select ([Rich selects](#rich-selects)).
- **`Panel { key, size, title, subtitle, body, actions, binds, bleed, centered, bare }`**: it changes in place while
  its key is open and keeps where its body is scrolled. `size` is `medium`, `large` or `xlarge`. A `bare` one is only
  the dialog's frame around its body. `close` is its header's close label, and `height` a set height for its body;
  one with a height and no actions has no footer row. `Close { key }` closes that panel.
- **`Confirm { title, message, label, action }`**: `Confirm` runs the action with the input `true`, `Cancel` and
  escape with `false`, and a dialog that replaces it runs nothing.
- **`Alert { title, message, action }`**: its action runs once after it closes, by enter, escape, or another dialog.
- **`ErrorDetails`**: an error in the host's own error view, with its `reference`.
- **`Images`**: images in the host's image preview.
- **`Surface { surface, key, size, centered, title }`**: the plugin's dialog surface as the dialog's body
  ([Panels, overlays and dialog surfaces](#panels-overlays-and-dialog-surfaces)).

A `Select`, an `Alert` and a `Confirm` may be `centered`, in the middle of the screen and not a quarter of the way
down, and an `Alert` and a `Confirm` have a `size` as a select has. A keyed select shown again with another `centered`
moves and keeps its filter and its selected row. With a `key`, `Read::dialog_open` answers for a select, a panel or
an error view while it shows.

Every dialog of a plugin belongs to the activation that showed it. It closes when that activation ends (disable,
failure, a reload that passed), and an answer reaches nobody once the activation is not live, not even a command of
the host or another plugin that the action names. A reload that fails keeps the running activation and its dialog.

### The composer

`composer()` reads the composer on screen, on home or in a session: its text as it shows it (a compact paste is its
label), the cursor as a byte offset into that text, and whether it has focus. It is `None` without a composer, and
while a session hides it for a permission, a form, a missing location or the drawer.

`edit_composer` takes:

- `Set { text }`: the text and its attachments are replaced, the cursor goes to the end, and the mode stays. A set
  tells the completion of the new text.
- `Insert { text }`: at the cursor, in place of a selection, as typing it does.
- `Submit`: as enter does, with or without focus. It does nothing while a home form disables the composer or another
  pane has the input. Behind an ordinary dialog the composer shows, so a submit sends and the dialog stays open.

The edits go through the composer's own edit path, and like every effect they wait for the call to return, so a call
that panics edits nothing.

## When claims render

A claim's first render gets `Changed::all`. After that, a mounted claim or route renders again:

- with each change batch of the store: `sessions` whose info or status changed, `lists` whose message list changed,
  `messages` that changed in place, and `locations` whose catalogs changed;
- with `local` when the host's own state changes: the selected model, the usage limits, the settings, the plugins'
  storage (also another client's write), the count of failed plugins, the open tabs, the pending keys and the
  themes;
- with `size` on a resize, and with `all` when `interactive` changes;
- with `woken` after each of the plugin's commands and its event, reply, mount, route-mount and wake handlers (queued
  after their effects, and coalesced), so a handler's change shows without a wake; and after a wake.

A claim of `sized` also renders with `size` when its own size changes, in the frame that laid it out, which then
shows the new node (at most twice a frame, then after it, for a node that changes its own size). A hidden claim has
no size: one that follows the width while showing nothing returns an empty column. This is for slots only. A route
reads the terminal's size.

A node that differs from the last one is reconciled into the widgets the claim has. A node of the same kind in the
same place keeps its widget and gets only what changed, so its state stays (a hovered text, a scroll offset). A theme
switch renders a route's and a slot's claims again in place. `Keep` keeps everything, so a render that `Changed`
shows is unaffected returns at once; it still takes a new theme. A node that nests more than 64 layout levels, or has
a size in percent that is not a finite number of 0 or more, is not drawn, and the claim keeps what it showed.

## Surfaces

`Setup::surface(v2::Surface)` registers a surface (`opencode_plugin_abi::v2`), shown as a route, which fills the
page, or a slot claim, which takes its root node's layout. Panels, overlays and the bodies of dialogs are surfaces
too ([Panels, overlays and input](#panels-overlays-and-input)).

**The tree.** A surface's view returns a keyed tree of `v2::Node`: box, text, slot, Markdown, spinner, scroll, diff,
input, list, code, image, canvas, fence and keep. A node may carry an `id`, unique in the tree, and a node with state
must: a scroll, a canvas, a list or its item, an input. The host keeps the widget of a node whose id stays, wherever
the tree puts it, so a scroll keeps its offset and the focus. A node of another kind under the id is built new. A
scroll with `scrollbar` shows a scrollbar while its content overflows.

**Memo.** `View::memo(key, value, build)` returns `Node::Keep` when `value` equals the one the subtree was last built
from in this mount. The host then adopts that subtree as it is. The value is remembered only once the host accepts a
tree that holds what `build` made.

**Mounts.** Each showing is a mount with a new generation, which owns the widgets, the memo table and the content
handles of `View::content`. All of it goes when the surface closes, and what the mount's calls asked for, such as a
fetch, ends with the mount ([Fetch](#fetch)). A content handle lives until the mount ends or `View::release`.

**Refusals.** A tree is adopted whole or refused whole. Nothing of a refused tree shows, nor the content its view
gave, and the last tree stays.

- A keep of an id the host does not hold makes the host ask at once for a whole tree (`SurfaceInput::full`, which may
  keep nothing). A second refusal in a row fails the plugin.
- Any other refusal fails the plugin at once: an id twice, a content handle the mount lacks, a node with state and no
  id, more than 64 layout levels, or a size in percent that is not a finite number of 0 or more.

**When a view runs.** A view hears what changed since the mount's last view in `SurfaceInput::changed`, as a render
hears `Changed`: `all` on the first view and on a whole tree, the change batch that called it, `local` or `size` for
a change of the host's own state or of the surface's room, and `woken` after the plugin's own handlers, a wake, or a
`layout` that asked to draw again. A change of the host's own state since the last view is `local`, also when the
view runs for another cause first.

A view that reads the host's state and finds nothing it shows changed returns `Node::Keep` of its last tree's root,
so its root needs an id. The host then keeps the mount as it is, with no work and no frame, unless the tree shows a
tool call's output (which the host reads again each revision) or is not in the theme of the moment: then the keep is
adopted as any tree is.

**Themes.** A theme switch restyles the widgets in place with no call, unless the surface reads the palette
(`Surface::palette`). Only a surface that declares it reads the palette gets the palette.

**Visibility.** A box with `visible: false` takes no room, not even a gap. A change of it shows or hides the box's
widget in place, so what a nested slot put in it stays. A slot surface whose root box is hidden shows nothing in its
slot, as a render's `Render::Hide`.

**Slot input and mounts.** A slot surface's view gets its slot's input as a slot claim does (`SurfaceInput::slot`:
the session, the prompt's state). A surface that asks (`Surface::mounts`) hears each mount begin, before its first
view, and end, as `Event::Mount` with the mount's id and the slot's input. A new mount may begin before the one it
replaces ends, also with equal input, and the id tells them apart. The plugin hears it, not the mount, so what its
handler starts (a fetch) is the plugin's and outlives that mount.

**Tool output.** A `Diff` or `Markdown` may name a tool call's output (`Source::PartOutput`) instead of carrying it.
The host shows the call's output as the transcript does, once it arrives.

**The fence node.** A fence claim's tree may hold one `Fence` node (the feature `fence-node`): the claimed fence as
the host's own code view draws it, in the transcript's theme, concealment and streaming state, on `bg` or the page's
background. The host keeps it current with each revision of the fence with no view, so a claim that only frames the
code memoizes its frame. It costs one node and one row against the tree's limits, whatever its code: a fence of 2,000
lines framed this way draws whole, where a `Code` of the same lines is past the rows and a placeholder. A surface's
tree that holds a `Fence` fails the plugin, and a claim's tree that holds two, or is a tool call's, shows the host's
row. A library lowers the node for a host without the feature (`View::or(Node::fence(), fallback)`), and the SDK
refuses a tree that still holds it before it crosses.

**Reading one message.** `Read::message(session, id)` reads one message. Over the C ABI only that message crosses,
where `Read::messages` copies the session's list, so a view that hears a message change in place reads what changed.

**Over the C ABI** the host runs a surface's view as the request `View`, with the mount, the input and the content
handle to number from. The plugin answers the tree, the content it gave and released, and the size of its memo
table, and `Unmount` drops that table when the mount ends.

## Panels, overlays and input

Module `opencode_plugin_abi::interact`.

### Panels, overlays and dialog surfaces

- **`Place::Panel(name)`**: `Host::open_panel` shows it beside the session on screen, or over the whole screen. Its
  view gets `SurfaceInput::panel`: its width, whether it is full screen, whether it has the input, and `forced` when
  it shows full screen because the room is too narrow. A panel follows every resize, a splitter drag too. When the
  composer takes the focus, a panel is told it lost the input.
- **`Place::Overlay(name)`**: `Host::overlay` shows it over everything but the host's dialogs: at a cell, under a
  node of the opening mount, against a screen edge, or inside another surface of the plugin that shows (a panel, a
  slot) against one of its edges. Anchored to a surface that does not show, it does not open. An overlay takes the
  focus. Escape (in any of its modes) and a press or a wheel outside it close it, and its opener's handler gets
  `Event::Closed`. The focus goes to the overlay below it, else back to where it was opened from. An overlay stays on
  the screen as the screen shrinks.
- **`Place::Dialog(name)`**: the body of a dialog, which `Host::dialog(Dialog::Surface(..))` opens by the surface's
  name. The host draws the dialog's frame, and the view draws the rest, with scrolls and fields. With a `title` the
  host draws the header too.
  - Each opening is a new mount, under `key` (the surface's name when unset), which `Dialog::Close` and
    `Read::dialog_open` name. Shown again while that key is open, the dialog changes its frame in place (its size,
    centering and title) and keeps the mount. Any other dialog replaces it.
  - However the dialog closes (escape, `ctrl+c`, the backdrop, another dialog, the plugin's close), its mount ends,
    and the surface's handler hears `Event::Closed` as the plugin's call, not the mount's.
  - While the dialog is on top, `Host::focus` gives the focus to the mount's nodes, its layers of no mode hold, and
    its handler hears the user's input. No other surface's do. The mount sets no mode, which would take the dialog's
    escape and `ctrl+c`.
  - `ctrl+c` first empties a field of the mount that has the focus and text, as in the host's own dialogs.

A panel's or an overlay's first view runs once the host lays it out, so it sees its size and how it shows. A theme or
mode switch restyles a panel and the plugin's overlays in place, with no new mount. While a host dialog is open, no
overlay opens and `Host::focus` does nothing, but for a node of the plugin's own dialog surface while its dialog is on
top.

### Layers and keys

`Surface::on(handler)` and `Surface::layers(layers)` give a surface its input. Each mount registers the layers.
`Setup::layer` registers a layer of the plugin's own, for the composer or everywhere.

- **Scope.** A layer's scope is the surface (the panel, the overlay, or a route while it shows), one of its nodes, the
  composer, or everywhere. A route's layer holds while no host dialog or overlay is over it, and a global one while
  no other plugin's overlay has the focus.
- **Binds.** A bind's key calls the handler with `Event::Key`, which names the key that matched (`k` of `up,k`) and
  its text only with no modifier but shift (`alt+i` types nothing). `Handled::Pass` lets the key go on down the
  host's order, by priority. `Bind::command` names the user's keybind a bind takes, such as `diff.next_hunk`: the
  config's keys for that name, else its default. `Read::shortcut` of the name shows them.
- **`any`.** A layer with `any` hears every key before any layer.
- **`paste`.** A layer with `paste` may take a paste in its scope, in a panel, an overlay, a route or a slot claim.
  Pastes reach these listeners by priority, the newest first among equals, as keys do. A global layer's `paste` hears
  one in the composer or in a plugin's surface before the host, and one that lands elsewhere once no host widget took
  it: a host dialog's input keeps its paste.
- **What a handler asks for applies before the next event of the same read.**

### Modes

`Host::set_mode` puts the caller's mount (or the plugin) in a mode, which only its layers of that mode hold in. The
mode holds in the scope it was set in: the surface with the focus, else the composer for an owner with a composer
layer, else everywhere. It never holds over a host dialog. The mode ends when the focus moves out of its scope (also
out and back within one call), when its owner ends, and on `ctrl+c`.

### `ctrl+c`

`ctrl+c`, however it is spelled, is no plugin's key, so no list, sequence or spelling of it in a bind runs. Before
the host's selection and every layer, it ends every plugin mode, drops what a hold kept (as a terminal's interrupt
drops typed-ahead input), and stops the plugins' layers where the focus is until it moves. Then it goes on to the
host, in the base mode.

Unless a selection copies it or a host dialog takes it, the host then closes one level of the plugin surface that has
the input: a focused overlay (its opener hears `Closed`), else a focused panel, else a plugin route, which goes back
to the route before it. Only where no plugin surface has the input is it `app.exit`'s. The composer's draft stays,
and a rebound `app.exit` changes none of this.

### Hold

A bind with `hold` keeps the keys and pastes after it, at most 256, until its owner calls `Host::release_keys`, 50 ms
pass or the limit is reached. Then they are routed in order, and those meant for a focus that a press or a command
moved since are dropped. A press is not kept: OpenTUI gives it to its widget first.

### Focus and fields

A box's `Interact` makes it focusable (`Host::focus`, `Host::blur`). A field (`Input`) with an id takes the focus
from `Host::focus` as from a click (the feature `focus-input`), and then what the user types, as the composer would,
after the layers whose scope holds. A scroll with an id takes the focus the same way, and then scrolls on the arrows
and the page keys.

- `Read::focused` names the focused node, and a `LayerScope::Node` of it holds while it has the focus.
- A focused node that a new tree builds again keeps the focus. One the tree leaves out gives it to its surface, else
  to the composer. A node in a hidden box takes none.
- A focus from a call the user did not cause (a wake, a reply) is taken too.
- A call may show a field and focus it: a node the mount's tree does not hold yet takes the focus if the mount's next
  view shows it, and the focus is dropped if it does not. A resize or a theme that shows the node later does not
  apply it. A command can show its dialog surface and focus a field in it: the focus of a node no mount holds yet
  names the mount that holds it once the effects before it applied.
- `Read::rect`, `Read::focused` and `Read::mode` read the running call's mount. A command reads, and `Host::focus`
  and `Host::blur` act on, the plugin's mount that holds the node or the focus.

### Pointer

A box's `Interact` gives `Event::Pointer` for press, release, drag after a consumed press, wheel and drop, and a
hover background with no call, or `Event::Hover`. A text with an id and `hover_events` gives `Event::Hover` too.

- A capture ends with the release, the node leaving the tree, a move of the focus, a host dialog or a resize.
- A press the handler consumes starts no selection of the text under it, and gives its surface the focus if the
  handler gave it to no node. On a box with a click of its own, a press the handler consumes runs no click.
- While a host dialog is open nothing reaches a pointer node.
- A drop says where the drag started (`Pointer::from`): a node of any mount of the plugin. A drag from a host widget
  or another plugin's node drops nothing.

### Scroll and input events

The same handler hears the scroll events (`Event::Scroll`: a step of the plugin's landed, or the user moved a scroll
that asks with `user_scroll`) and an `Input`'s with an id (`Event::Change` after each edit, `Event::Submit` on
enter). Their answer does not matter.

A handler of the user's own input (a key, a paste, a press, an edit, the user's scroll) may move the transcript, as a
command the user runs may. It runs owned by its mount, so what it asks for ends with it. Everything a mount registers
ends with it, and everything a plugin registers ends when it leaves `active`.

A handler and a select's search are calls of the plugin, timed and contained as any other. One that panics fails the
plugin, whose layers, modes, capture, hold and overlays then go, and the focus goes to the composer.

### Input over the C ABI

A library has the same input over the C ABI. Its manifest lists each surface's `handler` and `layers`, and its own
`layers` and `searches`. The host calls a handler as the request `input` (to a surface, for the mount it routes the
event to, or to a layer of the manifest) and a search as `search`. The verbs and reads are host requests of the
plugin's (`open-panel`, `close-panel`, `overlay`, `close-overlay`, `focus`, `blur`, `set-mode`, `release-keys`,
`rect`, `focused`, `input-mode`), which act on and read the mount whose call runs, as in process. Setup has no input
yet, so during `create` the host answers them with an error.

The example board (`crates/plugin/examples/board`) uses all of it, and gives the same frames linked, through the byte
shims and as a library (`crates/tui/tests/all/plugin_carriers.rs`).

### Rich selects

`Dialog::Select` with a `key` is the rich select. Shown again under its key while it is open, it changes in place and
keeps its filter and selection, and picking a row does not close it.

- **Rows.** A row may have its own action, a footer color, a gutter (the host's spinner, or a span), a `search_text`
  the filter matches beside the title and the category, or `toggle`.
- **`toggle`** names a plugin the host enables or disables when the user picks the row with a key or a click, never a
  run of a command by name. It is the host's own action `plugins.toggle` (the user's keybind, `enter` by default).
  Its title says `enable` or `disable` from that plugin's state. A row cannot toggle its own plugin, the plugin
  manager, or a plugin that did not load, and a disabled row toggles nothing. For a project's plugin waiting for
  approval, the toggle is `approve or decline`: the host asks its question and shows the select again on the row once
  it closes.
- **Actions and binds** run with the selected row's value. An action is primary when it runs on the row, unless
  `primary` says otherwise. `rowless` runs it with no row, also when nothing matches. `command` names the user's
  keybind that runs it instead of `key`, and `disabled` dims it. Neither may be `ctrl+c`. An action may not take
  `plugins.toggle` or a select command of the host, and one the host cannot bind is left out. An action that names a
  keybind the config knows takes the config's keys alone, so `none` turns it off.
- **Shown again** with other keys, the select is built again with its filter and selection. With only other titles,
  hidden rows or `disabled`, it changes in place.
- **`size` and `focus`.** A select has a `size`, and `focus`, a row selected as it opens, without `current`'s mark.
- **Search.** A select that names a search of `Setup::search` lists, for the query as it is typed and the empty one
  as it opens, the rows the search returns from the enabled ones, in its order and flat.
- **Query.** A select's `query` runs its action with the filter's text once it stayed `query_delay` ms, and the host
  filters nothing, as for rows a server search lists. `filterless` shows no filter, `empty` is the text while no row
  shows, and `note` a line under the rows.

## The plugin list

`Read::plugins` lists the TUI plugins in the host's order. Each entry has a key that names it and no other entry, its
ID, its target, its origin (built in, added, configured and not loaded, or external), its status (active, inactive,
skipped, failed, pending, declined), whether it has an activation, and whether it is slow and what its calls cost
then.

- **No error text.** An error can hold another plugin's paths, data or secrets, so the host shows it to the user
  alone, in an error view whose `plugin` names the entry.
- **`Setup::on_plugins`** runs after the list changed: a plugin enabled, disabled, loaded, approved, declined, failed,
  skipped by a config edit, or becoming slow or no longer slow. It runs once for changes that come together, and
  never when nothing changed, nor when only the cost of a slow plugin changed. A failed handler is a contained call
  named `on-plugins`.
- **Only the host changes the list.** A plugin offers a toggle row, named by the entry's key, and the user picks it.
- **Over the C ABI** the change is the request `{"type": "plugins"}`, and the read the host request
  `{"type": "plugins"}`. The pipe answers the read, but carries no change of the list.

The plugin manager (`opencode.plugins`, `crates/tui/src/plugins/manager.rs`) is a plugin of this contract. `/plugins`
opens its rich select, its rows follow `on_plugins` while the select shows, and the server rows, check and update are
fetches. While the manager has failed, the host keeps a read-only `/plugins` whose row for the manager starts it
again on the user's key or click (`crates/tui/src/plugins/fallback.rs`;
[`parity/deviations/F16-plugin-manager-fallback.md`](../parity/deviations/F16-plugin-manager-fallback.md)).

## Settings, images and bytes

The diff viewer (`opencode.diffs`, `crates/tui/src/plugins/diffs`) is a plugin of this contract, and the largest
example of it. Its docked panel and its route are two surfaces with one view. The cards are a windowed `List` whose
items are memoized, a card's heading is `sticky`, and its patch is a `Diff` whose hunks are anchors. Its keys are a
layer of its surface, its file menu an overlay, and its source, branch and help dialogs host dialogs. Beside what
the sections above describe, it uses:

- **Settings.** `Read::setting` and `Host::set_setting` read and save the host's named settings (`abi::SETTINGS`: the
  `diffs.*` keys of the TUI config). A value the setting does not take is not saved. Over the C ABI: the read
  `setting` and the request `set-setting`.
- **Bytes.** `Fetch::bytes`: the reply is the body's bytes in base64 (`abi::base64`), for a file the server reads.
- **Image sizes.** `Read::image_size(bytes)` is the size the host's own decoder gets from the bytes, its bounds
  included, or none where an image node of them would show nothing. `abi::image_size` reads only the header. Over the
  C ABI: the read `image-size`, with the bytes in base64.
- **Diffs and boxes.** `Node::Diff`'s `wrap` and `padding`, and the box builders `padding_sides` and `clip`. A sticky
  box paints over the siblings it is pinned above, as CSS's sticky does.

## Storage

`storage_key(key)` declares a key. Only declared keys read and write, as `plugin.<id>.<key>` in the TUI's storage.
Declared in setup, a key works in setup too.

- A value is an object or an array. The host ignores any other value.
- A write shows to `storage_get` at once. The host writes the disk later, in order, and renders the claims with
  `local`.
- `storage_merge(key, fields)` sets fields in the latest stored object under the storage lock and keeps the others,
  so fields another client stored stay.
- Writes queued when the TUI exits reach the disk before it does.
- At most 128 keys a plugin, and 256 KiB a value (`crates/plugin/src/storage.rs`).

## Fetch

`fetch` sends a request through the host's own client, with its credentials, to the server the TUI talks to now (a
managed service it follows across restarts).

- **The path** starts with `/` and stays on that server. A path that would reach another origin, such as
  `/https://elsewhere/`, is refused before the credentials go on.
- **The reply** comes back to the `on_reply` handlers on the UI thread, in order with the other effects, while what
  owns the fetch lives. It is the JSON body of any 2xx status, or `null` without a body. With `bytes`, it is the
  body's bytes in base64 as a JSON string, whatever they are.
- **An error is text:** a declared server error's message (else its tag); `UnexpectedStatus: 404: <body>` for another
  error status (the body trimmed and cut at 200 characters, and `UnexpectedStatus: 404` without one);
  `Transport: …` when the request could not be sent or would leave the origin; or `MalformedResponse: …` when the
  body is not JSON.
- **A fetch asked for by a failed setup or by a dispose callback is not sent.**

**IDs.** A fetch is given an ID only when its reply can come, on every carrier. An ID is never 0, which names no
request: the schema's `RequestId` starts at 1, and the SDK refuses an answer of 0 as malformed.

**Refusal.** The host's queue of effects is bounded. While the effects that wait fill it (a plugin that fans out
without end), or a chain of dispatches is too deep, the host does not take a fetch or a `foreground`, and no reply
comes for it. In the Rust SDK `try_fetch` and `try_foreground` return an `Err` with why. Over the C ABI the request
answers `OPENCODE_ERROR`. Over the pipe, the TypeScript fetch resolves as a failed reply. A fetch the host takes is
admitted past the bound, so every ID it gives gets its one reply.

**Ownership.** A fetch or a `foreground` belongs to what asked for it, the same in process, over the C ABI and over
the pipe.

- **A mount's.** One a mount's call asks for (a command of the route the mount shows, or a handler of the mount's
  input) is that mount's. Once the mount closes, it is not sent, a program queued for the end of the call does not
  start, and a reply that arrives later is dropped, also when the surface opened again under the same key, whose
  mount is another.
- **The activation's.** One from setup, a global or base command, an event, a wake, a message, a layer of setup, or
  the mount's begin and end (`Event::Mount`) is the activation's, and its reply comes unless the plugin is disposed
  first. The plugin hears a mount begin and end, not the mount: the end has no mount left to own anything, and a read
  the begin starts is the plugin's, which a next mount shows.
- **Cancel.** A Rust or C plugin whose manifest has `cancelled` (`Setup::on_cancelled`, which the SDK's tasks
  register) gets the request `{"type": "cancelled", "id": N}` once for a request its mount's close cancelled. One
  without it hears nothing of it.
- **Over the pipe,** the host tells the JS host of each request it cancels, at once as the mount closes. A TypeScript
  `fetch` of a mount that closed rejects with an `AbortError` ("the fetch was cancelled: the mount that asked for it
  closed"), as an aborted web fetch does, and leaves nothing pending, while the server still holds it. A TypeScript
  handler's call ends at its first `await`: what it asks for after that goes out in a batch of the activation's, not
  in the mount's call, and is the activation's, also when the mount closed meanwhile.

## Events

`on_event(types, run)` gets the server events of those types, after the store applied their batch, while the plugin
is active. The streaming deltas (`session.text.delta`, `session.reasoning.delta`, `session.tool.input.delta`,
`session.compaction.delta`) never arrive there. If the UI thread falls more than 1024 events behind, the oldest are
skipped.

`on_deltas(run)` gets the deltas instead: every delta the store applied since the last call, or since the handler was
registered, never one from before, oldest first.

- It is called at most once a frame, before the frame, and never with none. The deltas of one store batch come in one
  call. That holds also for a session whose messages the TUI has not loaded.
- While a plugin has such a handler the store keeps at most 4096 deltas it has not taken and drops the oldest past
  that. Without one the store keeps none. A plugin that fails or is disabled loses the handler.
- The TypeScript API calls a `data.on` handler once a delta. A plugin that counts deltas counts the events in the
  slice.

## Fence keys

`Fence::key` names a block while it changes, across renders that return `Lines` or `Keep`, so a plugin can keep state
for it. `on_fence_gone(run)` gets each key once, after the block whose output (`Lines` or `Keep`) showed goes or
falls back to the code view, on the UI thread after the event that freed it. A block that only ever returned `Code`
sends nothing. The host sends `FenceGone` only to a plugin that registered a handler.

## Threads and the waker

A plugin's threads send messages. `Setup::messages(run)` registers the handler, which the host runs on the UI thread
as the plugin's `update`, one call a message, then renders the plugin's claims and surfaces again. It returns a
`Sender`, which is `Clone` and `Send`.

- **The mailbox.** The host holds one mailbox of 256 entries a plugin (`BOUND`). `send` never blocks: it puts the
  message at the end, or hands it back at once as `Full`, or as `Closed` once the plugin has left `active` (disabled,
  failed, replaced), and what waited is then dropped. `replace(key, message)` takes the place of the message that
  waits under `key`, so a flood of progress holds one entry.
- **Threads.** `Setup::spawner()` starts named threads (`<id>:<name>`) with a `Stop` flag, set when the plugin leaves
  `active`, and catches a panic on them: the host fails the plugin and says so once. A thread cannot be killed.
- **On the wire** messages are JSON over the C ABI. In process they are the values.

Slow work, such as network I/O of the plugin's own, runs on the plugin's thread, which calls `Waker::wake` (from
`Setup::waker()`) when it has something to show. A wake is a redraw hint, not a message. The host posts it to the UI
thread. Wakes before it handles one count once, and the last is never lost, even when the queue is full. On the UI
thread the host runs the plugin's `on_wake` handlers, then renders its mounted claims and routes with `woken`. A
render shows every result that is ready, not one per wake. `Waker` is `Clone` and `Send`. Disposing the plugin
revokes every clone before the `on_dispose` callbacks run: it waits for wakes in progress, and a later wake does
nothing. Stop the threads in `on_dispose`, or when the plugin's state drops.

## Lifecycle

- **Load.** Loading a build reads its ID from `describe` and runs no setup. A library whose `describe` is null or
  names no ID is refused at load. A build whose ID another external plugin has is refused ("plugin ID … is already
  registered") and loads once that ID is free.
- **Activation.** Setup (`create`) runs on each activation. Deactivation, unloading, a reload and the TUI's exit
  destroy that instance, so a plugin that `cli.json` disables starts nothing.
- **Disposal.** Destroying an instance revokes its waker, then runs its `on_dispose` callbacks, last registered
  first, each even when another panics, while the host is still valid. Their effects run, except a fetch, which is
  not sent, and a dialog, which belongs to an activation that is no longer live and shows nowhere.
- **A failed setup.** A setup that returns `Err` or panics runs the `on_dispose` callbacks it registered, and the
  plugin is `failed` and inactive, with a toast. Enabling it in the plugin manager runs setup again.
- **A panic.** The shims catch the plugin's panics, and the host's callbacks catch the host's, so no panic unwinds
  across the boundary. The shims also silence the plugin's own panic hook, which would print over the TUI. An
  instance whose call panicked is called no more and is never destroyed, however it goes, so its `on_dispose`
  callbacks never run. The instance is kept, as its library is.
- **Reload.** `Loader::reconcile` loads new and changed builds (by content digest), unloads removed ones, and
  remounts the route when anything changed. A new build of an active plugin starts before the active one stops. When
  it fails to load or its setup fails, the running version keeps running. A failed build of an inactive or panicked
  plugin replaces its error, and enabling it fails the same way.
- **Libraries are never unloaded.** A running plugin's code must outlive every pointer into it, so a reload leaks one
  mapping.
- **Order.** A plugin keeps its place among the claims, and its fence precedence, across a reload and a toggle. An
  external plugin with a built-in's ID replaces the built-in in its place, and unloading it brings the built-in back
  there, enabled or failed as it was.

[`plugins.md`](plugins.md#running-plugins) describes discovery, approval, the watch that reloads, and what the user
sees of a failure.

## The JS host

TypeScript plugins run on the JS host: one Bun process for every TypeScript TUI plugin, started with the first one
(`crates/plugin/src/pipe`). It is behind the cargo feature `ts` of `opencode-plugin`, `opencode-tui` and
`opencode-cli`, which is on by default, and gates the pipe carrier, the JS host's spawn, the compatibility layer, and
the embedded `host.ts` and `compat.js`.

### Finding and starting Bun

Bun is looked for only when a plugin first needs the JS host, because looking runs a binary. It is the first of:

1. `OPENCODE_BUN`, an absolute path;
2. the `opencode` binary of a local server (a background service or a standalone server, not `--server`), run as the
   Bun it embeds (`BUN_BE_BUN=1`), when that Bun reports a version of 1.4.0 or newer. It is the executable of the
   server's process, where the client can tell it (Linux and Windows);
3. the `opencode` installed beside the client, for a remote server too;
4. where the client cannot tell the server's binary, the first `opencode` in an absolute `PATH` entry outside the
   project that answers as Bun (its real path, so a version manager's shim is passed over);
5. `bun` in an absolute `PATH` entry outside the project.

Bun starts in the JS host's private directory, with `--no-env-file`, `--no-install`, a `bunfig.toml` of its own that
holds only `[install] auto = "disable"`, and an allowlisted environment: what locates the user, the language, the
proxy, what names the terminal (such as `TERM`, `TERM_PROGRAM`, `COLORTERM` and `TMUX`), and the client's own; no
`BUN_*`, `NPM_*` or `NODE_*`. So nothing of the project the client works in loads as it starts. Bun installs nothing:
either switch alone turns its auto-install off, and the flag wins over a user's own bunfig.

### Loading a plugin

The JS host loads a directory's TUI module as the TypeScript client does (`package.json` `name` and `exports`, else
`tui.ts` and its kin) by file URL, and describes its `{ id, setup }` default export.

- Its setup runs only once the loader knows the plugin is enabled, so a plugin that `cli.json` disables runs nothing.
- Each load imports the plugin's modules afresh, its helpers included. A reload's setup runs on a candidate: the
  running version answers until the candidate's setup returned, and stays when it throws.
- A plugin that imports a package its directory does not hold fails to load, as "it imports the package '<name>',
  which is not installed with the plugin, and opencode-native installs nothing".
- An npm entry resolves in the TypeScript client's cache as its `Npm.resolve` finds it
  (`crates/plugin/src/loader/npm.rs`): `<cache>/npm/<key>/<newest generation>/node_modules/<name>`, the key being the
  spec's text (`name@latest` for a bare name). The directory a spec resolved to stays while it is a target, and is
  not watched.
- A plugin's files are read on a thread of their own, never on the UI thread. The plugin is listed as starting until
  the first walk ended. A global plugin's build is its own files' bytes and its dependencies by version (each
  installed package's `package.json`, and the lockfiles), not every file under `node_modules`.
- A project's plugin runs from a staged copy of the files the user approved, and imports nothing outside it. Its
  approval hashes every file in the directory, hidden ones and `node_modules` included. Safe mode holds a TypeScript
  plugin as it holds a library.

### The compatibility layer

The setup gets the context the TypeScript client gives it, from the compatibility layer
(`crates/plugin/src/pipe/compat`, bundled into `compat.js` by `script/gen/js-host.ts`). Its imports of
`@opencode/plugin/tui`, `solid-js`, `solid-js/store`, `@opentui/solid` (and its JSX runtimes) and `@opentui/core` get
the layer's, also from a package's own `node_modules`.

- A slot claim, a route and the session panel are surfaces. Each mount renders the plugin's JSX with Solid's
  universal renderer into plain nodes, and its view reads them into a contract tree: boxes with their borders,
  padding, margins, sizes and absolute positions, text with its spans, scroll boxes, Markdown, code, fields. A click
  runs the node's pointer handler.
- `ui.dialog.show` shows the plugin's view as a dialog surface: only the dialog's frame is the host's, its scroll
  boxes scroll, and its inputs are fields.
- `data` and the small reads (`ui.router.current`, `keymap.pending`, tabs, the model) are snapshots the host pushes
  for what the plugin reads.
- The verbs (`keymap.dispatch`, `ui.toast`, the dialogs, navigation, storage writes) are the carrier's effects.
- `client` is the generated client over the host's `fetch`.
- The layer's `markdown.registerCodeBlockRenderer` is a fence claim.
- A TS plugin uses the JS host's own `setTimeout` and `setInterval`.

What does not map warns once in a toast and does nothing, or throws in the render that used it
([`parity/deviations/F16-v2-compat-layer.md`](../parity/deviations/F16-v2-compat-layer.md)). An async setup that
waits on the host hands the plugin over at the wait. What it registers after, and what its components register,
reaches the host as a manifest, which it takes as a reload of the registrations.

### The carrier

Under `Symbol.for("opencode.carrier")` the context also has the carrier the layer is built on:

- `surface(name, place, view, { palette, notify, on, layers, mounts, unmount })`, with views that return contract
  trees (`memo`, nested too, `content`, `release`, a box's `visible`, a keep of the root that keeps the memo table)
  on a route, a slot, a panel or an overlay. A view's input has a slot surface's `slot` and no `changed`: the JS host
  views again when what the plugin watches changes.
- `layer(layer, handler)`.
- `claim(target, view)`, a renderer claim. Its `view(part)` returns a whole tree for the part, `null` to decline, or
  throws to fall the part back, and the returned function ends the claim.
- `command`, `on`, `storage(keys)`, `effect` (any host request), `watch`/`unwatch`/`read` (snapshots, at most 128),
  `invalidate`, `fetch`.

A renderer claim on the JS host answers after the frame. Until the first tree comes, the host's code view of a fence
shows; then the last tree shows while a newer part is in flight. A renderer that throws falls that part back for its
mount, and the plugin stays active. A plugin has at most 256 claims, and a fence over 256 KiB keeps the host's code
view. A part waits, unsent, while the queue to the JS host is backed up, and goes as it drains.

### The wire

The protocol runs both ways on the JS host's standard input: a socket pair on Linux and macOS, and on Windows a
duplex named pipe that belongs to the JS host by construction (a random name, its first and only instance, this
user's alone, local, its client connected before the JS host starts). Nothing a plugin writes can break it.

A plugin's `console` (every method) and `process.stdout`, its own modules' and its dependencies' included, write to
the JS host's standard error, which the client logs a line at a time. A write to the descriptor of standard output
itself (`fs.writeSync(1, …)`) is logged too, escaped, by the plugin whose code the JS host ran as it was written. At
most 10 such records a second and 64 KiB in all are logged for one JS host; the rest is counted. The TypeScript
client sends those bytes to the terminal
([`parity/deviations/F16-v2-compat-layer.md`](../parity/deviations/F16-v2-compat-layer.md)). A plugin that gives the
host what is not JSON (a `BigInt`, a cycle) fails alone.

### Timing

The pipe is the second timing tier. No frame waits for the JS host.

- **Events** (commands, events, input, replies) cross with a sequence. The JS host acknowledges each on receipt, says
  when it starts one, and answers once the handler returned and the views it made due were sent, with its effects,
  which apply then, in order (at most 256). A handler that throws has none and fails its plugin, as a panic does in
  process.
- **Input.** A key, a paste or a press cannot wait a round trip, so the host answers from what the plugin declared: a
  bind's key, a paste of a layer that takes pastes and a pointer event on a node that asks for them are consumed, and
  those handlers' answers are advisory. A key of a listener of every key that can take one now (the JS host says so)
  is held, as a key command's is, until the handler answers: `consume` takes it, and anything else lets it go on,
  below the listeners that heard it. A handler's effects are its mount's: the overlay it opens, the focus, its mode.
- **Trees** are revisions of a mount, one in flight. The host adopts a revision in its next frame, or refuses it and
  gets a whole one. Until a mount's first tree it shows a placeholder that keeps the rows its key had (or one). While
  a new tree is on its way, the last one shows.
- **Reads** are snapshots the host pushes for what the plugin watches: before each event, after each call's effects
  and at each change. A read too large for one frame goes in parts, as a large reply and a call's answers do. One
  past the plugin's content room, or past what the queue has room for now, is not pushed: the plugin reads nothing
  (`carrier.readError(key)` says why) and goes on, and the read is pushed again at the next refresh. There is no
  canvas draw.
- **Hold.** A command that declares `hold`, and a key a JS command or listener may decline, holds the input typed
  after it (keys and pastes, in order) until its handler's effects applied, or 50 ms. Past 64 held, the hold stops
  waiting and lets everything go on in order; none is dropped. Input typed into a mount that closed meanwhile goes
  with it. `ctrl+c` is never held: its press ends the hold, drops what it kept, and reaches the host.

### Supervision

The queues are bounded.

- **To the JS host,** 1 MiB is queued, and what does not fit waits in an overflow of 8 MiB that drains as it reads.
  Past that a message is refused (a handler's call is answered with nothing), and nothing ends for it. A message that
  settles the JS host's work (a fetch's reply, the answers of a call's effects, a cancellation) is never dropped
  while the JS host runs: past the overflow's bound it waits in a reserve as large again.
- **From the JS host,** 512 unread messages and 8 MiB, and 8 unread trees, after which it blocks in its write. A
  control message is at most 256 KiB and a tree 8 MiB; a larger message comes in pieces. What a plugin sends before
  it is registered is held within 256 messages and those 8 MiB.
- **Hung.** A JS host that owes an answer and sends nothing for 1 s (10 s for a started load or setup) is hung. A
  queue that moves is not hung.
- **Ended.** A JS host that is hung, or over a resident set of 512 MiB, is ended, and its process group is killed
  with it. The plugin whose work it said it ran when it ended fails (a handler, a view, a cleanup, a setup), as does
  one that flooded the host with effects. A memory end names nobody. The other plugins are set up again on a new JS
  host with new state, their surfaces keeping their last trees meanwhile, and get the calls the old one never
  started, in order, once each. Their modes end with it. Three ends in a minute fail every plugin on it.
- **With the client.** The JS host dies with the client however the client ends, and takes what its plugins started
  with it: when its input ends, on Linux on the parent-death signal, and everywhere from a thread of its own that
  watches its parent. On Linux it is a child subreaper, so a process a plugin started stays its descendant. On macOS
  only its process group is killed. On Windows a job holds the JS host and everything it starts, and the system
  closes it with the client.

## The host side

`crates/plugin` (`opencode-plugin`) is the host side: the `Registry`, slot resolution, the loader, and the renderer
that turns a node into widgets. Its `Host` trait is what the adapters of every carrier call. The TUI implements it
once, in `crates/tui/src/plugins/host.rs`, and that is the only code of the crate that sees the TUI. It is not plugin
API.

- **Built-ins.** `Registry::new` takes `Builtin`s: `Builtin::Plugin(abi::Plugin)`, or `Builtin::Abi(abi::Plugin)`
  for the same plugin through the C ABI's byte shims, which the tests that compare carriers use. The TUI's built-ins
  are in `crates/tui/src/plugins`, in the TypeScript client's order, with the diff viewer last. Mermaid
  (`crates/mermaid`) and LaTeX (`crates/latex`) come from the binary crate, so `opencode-tui` does not depend on
  them. None of them depends on OpenTUI.
- **Features.** The linked host serves every optional feature of the contract (`abi::FEATURES`), so a built-in uses
  them with no check.
- **Mounts.** A host mounts a slot with `host::slot(tui, parent, path, input, content)`. The claims go straight into
  `parent` in the order before, prepend, the host's own content (skipped when a claim replaces it), append, after. A
  mounted slot (`SlotMount`) or plugin route (`RouteMount`) syncs with `abi::Changed`, which the TUI builds from each
  store change batch.
- **Limits.** `crates/plugin/src/limits.rs` bounds what a tree may make the host build, `contain` times every call,
  and `crates/cli/src/contain.rs` is the parent that restarts the client after a native crash
  ([`plugins.md`](plugins.md#limits)).

## Examples and tests

| Path | What |
| --- | --- |
| `crates/plugin/examples/hello` | The quick start. `crates/plugin-abi/tests/sdk.rs` checks that the README and the guide show it as it is, and that it builds on the SDK alone |
| `crates/plugin/examples/sample` | A small `cdylib` with its own workspace and `Cargo.lock`. Its cargo features select the variants the loader's tests load: another drawing, a failing setup, other ABI versions and features, small probes |
| `crates/plugin/examples/author` | A larger author's fixture: storage, an event, a fence |
| `crates/plugin/examples/board` | Surfaces: a route of memoized cards, a panel, an overlay, a dialog surface, and a thread that floods its mailbox |
| `crates/plugin/examples/c` | A plugin in C on the header alone |
| `crates/plugin/examples/luau` | Luau plugins: the quick start, and a counter with a module of its own |
| `crates/plugin/examples/pipe` | TypeScript plugins for the JS host's tests |
| `crates/plugin/examples/conformance` | The conformance plugin, in Rust and in C |

The tests build each native example once per test run into `target/sample-plugin`.

- The loader's unit tests are in `crates/plugin/src/loader/native/tests.rs`, and the TUI's in
  `crates/tui/tests/all/plugins.rs` and the `plugin_*.rs` files beside it.
- `plugin_carriers.rs` links the board's source, runs it through the byte shims of the C ABI in process, and loads
  its `cdylib`, and compares frames, toasts and status at every step.
- `plugin_published.rs` and the P-APP scenarios under `parity/scenarios/P.8` run published TypeScript plugins,
  unmodified, on the JS host. The packages are pinned in `parity/plugins/npm`. Ports of ten of them to Rust and to
  Luau are in the separate `plugins` repository.
- `parity/machines/plugins.json` is a state machine of a plugin's life that both clients' tests read
  ([`testing.md`](testing.md#the-plugin-state-machine)).

## Conformance

The conformance suite holds the C ABI still for every binding. `crates/plugin/conformance/scripts.json` lists
scripted sessions: activation and its end, commands and the host requests they make, surfaces with content and
memoized subtrees, the mailbox and a wake, a canvas, scroll verbs and reads, input, searches, renderer claims of a
tool call and of a fence, dialogs, the plugin list, a panic, a refused tree, a setup that fails, and an overrun.

Each is recorded from `crates/plugin/examples/conformance` (the reference, linked into the loader's tests and called
through the SDK's byte shims) into `crates/plugin/conformance/transcripts.jsonl`: every request and reply that cross
the C ABI on the UI thread, with what the user sees at each `observe` step. `CONFORMANCE_WRITE=1` on the loader's
`conformance::` tests writes it, and `versions.jsonl`, again. Nothing else does.

A transcript keeps what the host sends as JSON, which compares exactly, but for two process-wide counters: mount
generations are numbered by first appearance and content handles by the order the transcript's views gave them. It
keeps what the library sends as the host reads it: decoded with the host's types and written again, so field order,
defaults and unknown fields do not count. A canvas's list is kept as its bytes, in hex. Statuses, error texts and
panic texts compare exactly.

Each transcript is checked on both sides (`crates/plugin/src/conformance/tests.rs`):

- the reference records it again, so a host or SDK change that changes what crosses fails until the file is written
  again;
- the host runs the script against a plugin that answers from the transcript, and records it, also when that plugin
  is of a later minor (a longer table that says minor 1, a field the host does not know in every object, and a
  request no host knows inside each call, which the host answers with an error);
- a fake host drives the reference built as a `cdylib`, and `examples/conformance/plugin.c`, built with symbols
  hidden and every warning an error, through every transcript of their major, also as a host of a later minor;
- every part of every entry changed, or the entry dropped, fails the side that writes it.

`the_version_gate_is_exact` runs a grid of tables (each entry, majors 0 to 3, minors at, below and above the host's,
`requires_minor` at and past it, tables cut short, `describe` answers that fail, cannot be read, require an unknown
feature or carry an unknown field) through the host's gate, checks each verdict against the header's rule, and pins
the words in `versions.jsonl`.

The tap that records transcripts also feeds a protocol machine written from `opencode_plugin.h`
(`conformance::Protocol`): one call at a time, host requests only inside a call, no call into an instance that failed
or is destroyed, renders read only, and only requests the contract names. Every seeded model of the TUI's tests runs
under it.

A new request or surface kind adds a transcript, not harness code: it goes into the conformance plugin in Rust and
in C and into a script, and the writer records it.

## Authoring commands

`opencode-native plugin dev <dir>` builds the plugin crate in `<dir>`, runs the TUI with its library beside the
configured plugins (a settings change keeps it, and it is never saved), and builds it again after a change in any
directory of the crate but `target` and hidden ones. The TUI's reload takes the new library. A failed build leaves
the running one, with its output in `<dir>/target/opencode-dev/build.log` and a toast that names the log until the
next build.

`opencode-native plugin test <library, crate or plugin dir> [--route NAME] [--size WxH] [--command NAME[=INPUT]]
[--wait TEXT]...` loads the plugin into the TUI on the headless renderer, with no server, and prints text frames. It
exits with an error when the plugin does not load or fails, the route is not the plugin's, or a command does not run.
Its clock is its own, but the plugin's threads run in real time: `--wait TEXT` advances the clock until the frame
shows `TEXT`, for ten seconds at most.

`opencode-native plugin test <library> --conformance` replays the conformance transcripts against a library and
prints a line a transcript. A library passes when it is the conformance plugin: whoever binds the C ABI in another
language ports that plugin to prove the binding.

Neither command is in the TypeScript CLI, so neither is in `--help`; each takes `-h`
([`parity/deviations/D01-plugin-dev-test.md`](../parity/deviations/D01-plugin-dev-test.md)).
