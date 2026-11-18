# The plugin contract

This is the reference for the contract between `opencode-native` and its plugins: the C ABI, what a plugin registers
and draws, what each callback may do, and how the host runs a plugin on each carrier. Read [`plugins.md`](plugins.md)
first. The contract is the crate `crates/plugin-abi`, whose rustdoc documents every type; the host side is
`crates/plugin`. Paths are relative to `packages/cli-rs`.

## The C ABI

A native plugin is a shared library (`.so`, `.dylib`, `.dll`) that the host opens with `opencode_util::dl`. The
boundary is C, because the Rust ABI changes with every compiler and crate version. The library exports one symbol,
`opencode_plugin_v2`, which returns a `#[repr(C)]` table, `PluginApi`. Rust gets it from `plugin!`; C declares it
with `crates/plugin-abi/include/opencode_plugin.h`.

| Entry | Purpose |
| --- | --- |
| `size`, `major`, `minor` | Read first, before anything else |
| `requires_minor` | The oldest host minor the plugin works with |
| `create(host, options, &instance, &out)` | Runs the setup; writes the manifest JSON |
| `call(instance, request, &out)` | Handles a request; writes the result JSON |
| `destroy(instance)`, `free(buffer)` | Ends an instance (optional); frees a buffer the plugin wrote |
| `describe(&out)` | The plugin's ID and version, read before any setup |

The host passes a `HostApi` table: `size`, `major`, `minor`, `ctx`, `call`, `free`, and the nullable
`theme_mode(ctx)`, `wake(ctx)`, `send(ctx, key, message)`, `report(ctx, message)`, `stopped(ctx)` and `features`.
`wake`, `send`, `report` and `stopped` may be called from any thread until `destroy` returns.

Everything else crosses as JSON in byte buffers: the `Manifest`, a `Request` from the host, and a `HostRequest` from
the plugin. The rustdoc of `Request` and `HostRequest` lists every request and its answer. Each side frees what it
allocated, and a buffer over 256 MiB is refused unread. An answer the host cannot decode (cut short, not JSON, an
unknown node kind) fails the plugin and leaves no effect, as a panic does.

The host opens a copy of each build, because the platform loader returns a library already open at the same path and
build tools overwrite builds in place. On macOS the copy keeps the file's quarantine. When the system refuses a
library, the plugin manager names the file, the cause (another team's signature, a download's quarantine, a missing
or invalid signature) and what to do.

### Versions

The ABI is 2.0, and it only grows by appending:

- **Tables.** A table shorter than 2.0's is refused. A later minor's entry goes at the end and is optional, and a
  reader treats entries past the other side's `size` as absent.
- **JSON.** Payloads only gain optional fields, and readers ignore unknown fields.
- **A newer plugin on an older host** loads and uses what the host offers. Either side answers a request it does not
  know with an error, and the host sends a library no request newer than the minor its table states. A plugin that
  needs a newer host says `plugin!(id = id, requires_minor = N, setup)`, and an older host refuses it: "plugin needs
  host ABI 2.1 or newer, this opencode-native has 2.0; update opencode-native".
- **One major.** Any other major is refused: "plugin ABI 3.0 is not supported: this opencode-native loads ABI 2.x
  plugins (up to 2.0); rebuild the plugin against opencode-plugin-abi 2". A library that exports
  `opencode_plugin_v1` is refused as "plugin ABI 1.x". Nothing is removed inside a major.
- **Features.** The host states optional features in `HostApi::features`, read with `Read::abi`
  (`Abi::has_feature`). A 2.0 host has `image-bounds`, `focus-input` and `fence-node`. A plugin that needs one lists
  it in `Metadata::requires`, and a host without it refuses the plugin at load. The SDK's
  [README](../crates/plugin-abi/README.md#compatibility) describes each, and what the Rust SDK promises a plugin's
  source.

## What setup registers

`plugin!(setup)` takes the plugin's ID from the crate's package name, `plugin!(id = "my.plugin", setup)` names it,
and `setup` is `fn(&mut Setup) -> Result<(), String>`. The macro generates the table, `describe` and the shims, and
holds every `unsafe`. A plugin built with `panic = "abort"` does not compile.

Setup registers everything as data, because widgets and closures cannot cross the boundary:

| TypeScript plugin API | `opencode_plugin_abi::Setup` |
| --- | --- |
| A keymap layer's commands | `command(Command, run(&dyn Host, input))` ([Commands](#commands)) |
| A code block renderer | `code_block(language, render(&dyn Read, &Fence) -> Fenced)` |
| A slot | `slot(Placement, render(&dyn Read, &SlotInput, &Changed) -> Render)` |
| A slot component's lifetime | `on_mount(Placement, run(&dyn Host, &SlotInput, mounted))` for the claim registered last there: `true` before a mount's first render, `false` as it unmounts |
| A route | `route(name, render(&dyn Read, &Changed) -> Render)`, centered in a scroll box on the page background |
| A route page's `onMount` | `on_route_mount(name, run(&dyn Host, mounted))`, however the route was opened |
| A storage key | `storage_key(key)` ([Storage](#storage)) |
| `api.event.on` | `on_event(types, run(&dyn Host, &V2Event))` ([Events](#events)) |
| `data.on("session.*.delta")` | `on_deltas(run(&dyn Host, &[V2Event]))`, at most once a frame |
| `api.client` | `Host::try_fetch(Fetch) -> Result<RequestId, String>` and `on_reply(run(&dyn Host, RequestId, Result<Value, String>))` ([Fetch](#fetch)) |
| A timer's tick | `Setup::waker()` on the plugin's thread, and `on_wake(run(&dyn Host))` on the UI thread |
| A fence's cleanup | `on_fence_gone(run(key))` ([Fence keys](#fence-keys)) |
| The cleanup `setup` returns | `on_dispose(run(&dyn Host))` |
| `api.themeMode` | `Read::theme_mode()` |
| The composer's `ref`, `renderer.currentFocusedEditor` | `Read::composer()` and `Host::edit_composer(ComposerEdit)` ([The composer](#the-composer)) |
| `onSizeChange` and `this.width` in a slot | `sized(Placement)` for the claim registered last there: `SlotInput::width` and `height`, and a render with `Changed::size` when they change |
| `ui.model.current`, `ui.model.variant.list/set` | `Read::model`, `Read::variants`, `Host::set_variant`, `Host::set_model` |
| `ui.tabs.enabled/list/open/focus/move/close` | `Read::tabs_enabled`, `Read::tabs`, `Host::edit_tab(TabEdit)` |
| `keymap.pending/active/commands/shortcuts` | `Read::keymap_pending`, `keymap_active`, `keymap_commands`, `shortcuts(name)` |
| `renderer.getSelection()`, `clearSelection()` | `Read::selection`, `Host::clear_selection` |
| `renderer.suspend()`, a program, `resume()` | `Host::try_foreground(Foreground)` ([Foreground programs](#foreground-programs)) |
| `renderer.setTerminalTitle` | `Host::set_title(title)` |
| `api.theme.selected/has/set/install` | `Read::theme`, `Read::themes`, `Host::set_theme`, `Host::install_theme` |
| `<a href>` in a text | `Span::link(url)`, an OSC 8 link |
| `dialog.set({ size: "xlarge" })` | `PanelSize::XLarge` |

`Setup::options()` holds the `options` of the plugin's `plugins` entry as JSON text. `Setup::host()` is the host
while setup runs; no callback can keep it. `Setup::tasks()` starts [tasks](plugins.md#waiting-tasks-await-and-timers).

### Commands

A command has a palette entry, a slash name with aliases, keybinds and `enabled`; the host builds its keymap layer. A
command with neither `palette` nor `slash` is hidden, and runs only by a click or `Host::dispatch`. A disabled one
(`Command::disabled`, `Host::set_enabled`) binds no key and is in neither list. A run that returns `Handled::Pass`
declines its key, which goes on as if the command were not there. A command of `Scope::Route(name)` runs while that
route shows; its `description` and `arguments` show in the palette and the prompt, and the slash command passes its
text as the input.

## What a plugin draws

A `Line` is a list of spans with text, colors, bold, italic, underline, dim, strikethrough and an OSC 8 `link`. A
color is a theme token path (`text.muted`), a scale step (`categorical.3.300`), `#rrggbb`, or an `Rgba` (sent as
`#rrggbbaa`), so plugins follow the theme; `Read::color(token)` resolves one. Rows do not wrap.

**Fence renders** return `Fenced::{Code, Keep, Lines { lines, fg, drag }}`. `Fence::key` names the block across
renders, and `Fence::width` is the terminal's columns. `fg` colors spans without one. `Lines` scrolls sideways on a
horizontal wheel, as LaTeX does; with `drag` it also scrolls under a left drag and swallows the horizontal wheel, as
Mermaid does.

**Slot and route renders** return `Render::{Keep, Hide, Show(Node)}`. A `Node` is a `Box` (a column or row, with
gap, padding, justification, alignment, background, border, wrapping and overflow), a `Text` (spans, with wrapping,
truncation and a hover color), `Markdown { text }` with the active fence renderers, a `Spinner { label }`, or a
`Slot { path }`: the claims of a published slot mounted inside this one (such as `home.footer.status` in
`home.footer`), which get each change batch the outer claim gets. Each has a `Layout` (sizes with minimums and
maximums, grow, shrink, margins) and an optional `Click`, whose `Action::Command { name, input }` runs a command of
the plugin's or the host's (such as `mcp.list` with a server name) once the press or release is handled. A surface's
view returns a `v2::Node`, which has more kinds ([Surfaces](#surfaces)).

### Slots

| Path | Where | `SlotInput` |
| --- | --- | --- |
| `home.footer`, `home.footer.status` | the home screen's footer, and its status part | none |
| `prompt.footer`, `prompt.footer.status`, `prompt.footer.file` | the prompt's footer row | the session, if any, and `prompt { shell, show_details }` |
| `session.composer.top` | above the session's prompt | the session |
| `sidebar.content`, `sidebar.footer` | the session sidebar, while it shows | the session |
| `app` | under the route, on every route | none |

`session.panel` is published, but neither TUI mounts it, so claims there draw nothing.

`SlotKind` places a claim `before` or `after` the slot, or `prepend`s or `append`s it inside, in plugin order. A
`replace` claim replaces the slot's content and every claim inside it; the last one per path wins, and one on an
ancestor beats one on a descendant. A claim on an unmounted child path goes to the nearest mounted ancestor. A slot
mounts its claims again when its input changes. `slot::resolve` in `crates/plugin/src/slot.rs` holds these rules.

## What a callback may do

Every call into a plugin runs on the UI thread, so a callback must return quickly. `HostApi::call` and `theme_mode`
refuse a call from another thread with `ERROR` (the theme reads dark); a plugin's own thread calls `wake`.

### Reads

A render (a fence, a slot claim, a route) gets a `Read`. Reads are pure, also inside the `messages` visitor. A
catalog that is not loaded reads as `None`; the host starts the load once the outermost callback returns, and the
claim renders again with the location in `Changed::locations`. Every read of one call sees one store snapshot: a
batch applied on another thread meanwhile waits for the call. Over the ABI each read is one `HostRequest`.

| Read | What |
| --- | --- |
| `session`, `family`, `messages`, `message(session, id)` | a session, its family, its messages, one message. Over the ABI `message` copies one message where `messages` copies the list |
| `models`, `mcp_servers`, `integrations`, `vcs` | a location's catalogs |
| `model`, `variants`, `limits`, `providers` | the next prompt's model, its variants, usage limits, providers |
| `info` | the version, the terminal size, the working directory, the failed plugin count, the user's locale |
| `utc_offset(at)`, `measure(text)` | the host's zone at an instant; a text's cells and graphemes as the host draws them |
| `route`, `interactive` | the route, and whether the session pane owns the input |
| `shortcut(name)`, `shortcuts(name)`, `keymap_pending`, `keymap_active`, `keymap_commands` | keys as the TUI shows them |
| `dialog_open(key)` | whether the plugin's keyed dialog shows |
| `composer`, `storage_get`, `selection` | the composer, a declared storage key, the mouse selection |
| `color`, `theme_mode`, `theme`, `themes` | a resolved color, dark or light, the selected theme, every theme |
| `tabs_enabled`, `tabs` | each tab's root session, title, and whether it shows, is busy, waits on the user, or has unread activity or an error |
| `plugins` | the TUI plugins ([The plugin list](#the-plugin-list)) |
| `setting(name)`, `image_size(bytes)` | [Settings, images and bytes](#settings-images-and-bytes) |
| `rect`, `focused`, `mode` | of the running call's mount ([Focus and fields](#focus-and-fields)) |

The selection is live widget state: it goes when its anchor widget goes, and a key press clears it before the keymap
runs. A plugin cannot set it.

### Effects

Setup, commands, and the handlers of events, replies, mounts, route mounts, wakes and disposal get a `Host`: the
reads plus effects. Effects run once the outermost callback returns, in order, on the queue the built-ins use, and
before the host routes its next message. Over the ABI, a request into a plugin that is already running is dropped and
logged, and during a render request (`RenderFence`, `Render`, `RenderRoute`) every effect is refused. A result the host
cannot decode leaves no effect and puts back the storage it wrote. What a panicking dispose callback asked for is
dropped (the SDK sends `Checkpoint` and `Rollback` around each).

- `storage_set`, `storage_merge` ([Storage](#storage)).
- `dispatch(name, input)` runs any registered command.
- `toast(Toast { variant, title, message, session })`. With a `session` it offers "Open" unless that session's
  family shows, and an untitled toast takes the session's title.
- `attention(Attention { title, message, notify, sound })`, as the user's `attention` settings allow.
- `open_route(name)`, `navigate(Route)`: home, a session, or a plugin's route.
- `dialog(Dialog)` ([Dialogs](#dialogs)).
- `copy(text, then)` runs `then` once copied.
- `edit_composer(ComposerEdit)`, `try_fetch`, `try_foreground`.
- `set_model(provider, model)`, ignored for a model the TUI does not list.
- `clear_selection`.
- `set_title(title)`, also with `terminal.title: false`. The TUI sets its own title at its next change and clears a
  plugin's on exit.
- `install_theme(name, json)`: written as `<config>/themes/<name>.json`, then listed. A name that is not a plain file
  name, or a value without `theme` or `base`, is refused.

Three verbs return at once whether they will act, as their TypeScript counterparts do, and act once the call
returns. Each counts what the same call did before:

- `set_variant(variant)`: `false` without a model or for a variant it lacks (counting an earlier `set_model`). `None`
  is the default.
- `edit_tab(TabEdit::{Open, Focus, Move, Close})`: `false` while tabs are off, for a `Move` of a tab that is not
  open, and for a `Close` that matches none. `Open` adds a tab without showing it, `Focus` shows it, `Move` takes any
  session of the tab's family, `Close` the tab's own ID.
- `set_theme(name)`: `false` for an unknown theme (counting an earlier `install_theme`). It saves `theme.name` as the
  theme dialog does.

### Foreground programs

`foreground` hands the terminal to a program, as the TUI does for `$EDITOR`: once the call is done, the TUI restores
the terminal, runs the program, waits, and sets the terminal up again.

- It runs in `cwd`; else in the TUI's working directory when that exists here (a remote server's may not); else in
  the TUI's own directory.
- The reply is `{ "code": <exit code or null> }`, plus `"signal"` on Unix, or the error when it did not start.
- One program has the terminal at a time, shared with `$EDITOR`. A request while one waits or runs is refused, and so
  is one in a headless TUI or from a plugin disabled before the program started.
- The program gets the terminal's three standard streams, standard error included, and the signals of the terminal's
  keys; the TUI gets none (`opencode_util::job`; [`F16-plugin-foreground.md`](../parity/deviations/F16-plugin-foreground.md)).
  On Linux and macOS it runs in its own process group, the terminal's foreground group. Ctrl+C and Ctrl+\ signal it
  alone, and Ctrl+Z stops it, which the TUI continues at once, having no shell to hand it to. On Windows the TUI
  ignores Ctrl+C and Ctrl+Break while the program runs, and its standard error is `CONOUT$`. Input it leaves unread
  is dropped, so it does not reach the composer.
- The TUI sets up only its own terminal modes again and resends the title. A mode the program pushed (a Kitty
  keyboard flag, say) stays.

### Dialogs

- **`Prompt`**: a field filled with `value`, under `description`; its text goes to the action as the input.
- **`Select { title, placeholder, options, current, action }`**: a pick closes it and goes to the action. With a
  `key` it is a [rich select](#rich-selects).
- **`Panel { key, size, title, subtitle, body, actions, binds, bleed, centered, bare }`**: changes in place while its
  key is open and keeps its scroll. `size` is `medium`, `large` or `xlarge`; `bare` is only the frame around the
  body; `close` labels the header's close; a `height` with no actions has no footer row. `Close { key }` closes it.
- **`Confirm { title, message, label, action }`**: Confirm runs the action with `true`, Cancel and escape with
  `false`; a dialog that replaces it runs nothing.
- **`Alert { title, message, action }`**: the action runs once after it closes, by enter, escape or another dialog.
- **`ErrorDetails`** (the host's error view, with a `reference`) and **`Images`** (the image preview).
- **`Surface { surface, key, size, centered, title }`**: a [dialog surface](#panels-overlays-and-input).

`Select`, `Alert` and `Confirm` may be `centered` (rather than a quarter of the way down), and `Alert` and `Confirm`
take a `size`. With a `key`, `Read::dialog_open` answers for a select, panel or error view. A plugin's dialog belongs
to the activation that showed it: it closes when that activation ends, and no answer reaches anything after that,
not even a host command the action names. A reload that fails keeps the activation and its dialog.

### The composer

`composer()` reads the composer on screen, on home or in a session: its text as shown (a compact paste is its label),
the cursor as a byte offset, and whether it has focus. It is `None` without a composer, and while a session hides it
for a permission, a form, a missing location or the drawer. `edit_composer` takes:

- `Set { text }`: replaces text and attachments, moves the cursor to the end, keeps the mode, and updates completion;
- `Insert { text }`: at the cursor, in place of a selection, as typing does;
- `Submit`: as enter does, focused or not. It does nothing while a home form disables the composer or another pane
  has the input. Behind an ordinary dialog the composer shows, so a submit sends and the dialog stays.

## When claims render

A claim's first render gets `Changed::all`. After that, a mounted claim or route renders again:

- with each store batch: `sessions` whose info or status changed, `lists` whose message list changed, `messages`
  changed in place, `locations` whose catalogs changed;
- with `local` when the host's own state changes: the model, usage limits, settings, the plugins' storage (another
  client's writes too), the failed count, tabs, pending keys, themes;
- with `size` on a resize, and `all` when `interactive` changes;
- with `woken` after each of the plugin's commands and handlers (queued after their effects, coalesced), and after a
  wake.

A `sized` claim also renders with `size` when its own size changes, in the frame that laid it out (at most twice a
frame, then after it). A hidden claim has no size, so one that tracks its width while showing nothing returns an
empty column. Routes read the terminal's size instead.

A node of the same kind in the same place keeps its widget and gets only what changed, so its state stays. A theme
switch renders a route's and a slot's claims again in place. `Keep` keeps everything, so a render that `Changed`
does not affect returns at once. A node nested over 64 layout levels, or with a percent size that is not a finite
number of 0 or more, is not drawn, and the claim keeps what it showed.

## Surfaces

`Setup::surface(v2::Surface)` registers a surface (`opencode_plugin_abi::v2`): a route that fills the page, a slot
claim that takes its root's layout, a panel, an overlay, or a dialog's body.

**The tree.** A view returns a keyed tree of `v2::Node`: box, text, slot, Markdown, spinner, scroll, diff, input,
list, code, image, canvas, fence and keep. An `id` is unique in the tree, and a node with state must have one: a
scroll, a canvas, a list or its item, an input. The host keeps the widget of a node whose id stays, wherever it moves,
so a scroll keeps its offset and the focus; a node of another kind under the id is built new. A scroll with
`scrollbar` shows one while its content overflows.

**Memo.** `View::memo(key, value, build)` returns `Node::Keep` when `value` equals what the subtree was last built
from in this mount, and the host adopts that subtree as is. The value is remembered only once the host accepts a tree
that holds what `build` made.

**Mounts.** Each showing is a mount with a new generation. It owns the widgets, the memo table, the key layers, the
content handles of `View::content` (live until the mount ends or `View::release`), and its requests
([ownership](plugins.md#ownership-and-cancel)). All of it ends with the mount.

**Refusals.** A tree is adopted or refused whole; after a refusal nothing of it shows and the last tree stays. A keep
of an id the host does not hold makes the host ask at once for a whole tree (`SurfaceInput::full`), and a second
refusal in a row fails the plugin. Any other refusal fails it at once: an id twice, a content handle the mount lacks,
a stateful node without an id, more than 64 layout levels, or a bad percent size.

**When a view runs.** `SurfaceInput::changed` says what changed since the mount's last view: `all` on the first view
and on a whole tree, the store batch that called it, `local` or `size` for the host's state or the surface's room, and
`woken` after the plugin's handlers, a wake, or a `layout` that asked to draw again. A view that finds nothing it shows
changed returns `Node::Keep` of its root (so the root needs an id), and the host does no work and draws no frame,
unless the tree shows a tool call's output or is not in the current theme.

**Themes.** A theme switch restyles the widgets in place with no call, unless the surface reads the palette
(`Surface::palette`).

**Visibility.** A box with `visible: false` takes no room, not even a gap. Toggling it shows or hides the widget in
place, so what a nested slot put in it stays. A slot surface whose root is hidden shows nothing, as `Render::Hide`.

**Slot input and mounts.** A slot surface's view gets its slot's input (`SurfaceInput::slot`). A surface that asks
(`Surface::mounts`) hears each mount begin, before its first view, and end, as `Event::Mount` with the mount's id and
the slot's input. A new mount may begin before the one it replaces ends; the id tells them apart. The plugin hears
these, not the mount, so what the handler starts is the activation's.

**Tool output.** A `Diff` or `Markdown` may name a tool call's output (`Source::PartOutput`) instead of carrying it,
and the host shows it as the transcript does, once it arrives.

**The fence node.** A fence claim's tree may hold one `Fence` node (feature `fence-node`): the claimed fence as the
host's code view draws it, in the transcript's theme, concealment and streaming state. The host keeps it current with
no view, so a claim that only frames the code memoizes its frame. It counts as one node and one row against the tree's
limits, so a 2,000-line fence framed this way draws whole, where a `Code` of the same lines would be cut to a
placeholder. A `Fence` in a surface's tree fails the plugin, and a claim's tree that holds two, or is a tool call's,
shows the host's row. Lower it for an older host with `View::or(Node::fence(), fallback)`; the SDK refuses a tree
that still holds one.

**Over the C ABI** the host runs a view as the request `View`, with the mount, the input and the next content handle.
The plugin answers the tree, the content it gave and released, and its memo table's size. `Unmount` drops that table.

## Panels, overlays and input

Module `opencode_plugin_abi::interact`.

- **`Place::Panel(name)`**: `Host::open_panel` shows it beside the session, or full screen. Its view gets
  `SurfaceInput::panel`: its width, whether it is full screen, whether it has the input, and `forced` when the room is
  too narrow to split. It follows every resize and splitter drag, and is told it lost the input when the composer takes
  the focus.
- **`Place::Overlay(name)`**: `Host::overlay` shows it over everything but the host's dialogs: at a cell, under a node
  of the opening mount, against a screen edge, or inside another showing surface of the plugin against one of its
  edges (it does not open if that surface does not show). It takes the focus. Escape (in any mode) and a press or wheel
  outside close it, and its opener hears `Event::Closed`; the focus goes to the overlay below, else back where it came
  from. It stays on screen as the screen shrinks.
- **`Place::Dialog(name)`**: a dialog's body, opened by `Host::dialog(Dialog::Surface(..))`. The host draws the frame
  (and the header, with a `title`), and the view draws the rest. Each opening is a mount under `key` (default: the
  surface's name), which `Dialog::Close` and `Read::dialog_open` name. Shown again under an open key, it changes its
  frame in place and keeps the mount; any other dialog replaces it. However it closes, its mount ends and the handler
  hears `Event::Closed` as an activation call. While it is on top, only its mount's nodes take `Host::focus`, its
  modeless layers hold, and its handler hears input; it sets no mode, which would take the dialog's escape and
  `ctrl+c`. `ctrl+c` first empties a focused field that has text.

A panel's or overlay's first view runs once it is laid out, so it sees its size. A theme or mode switch restyles
panels and overlays in place. While a host dialog is open, no overlay opens and `Host::focus` does nothing, except for
the plugin's own dialog surface on top.

### Layers and keys

`Surface::on(handler)` and `Surface::layers(layers)` give a surface its input; each mount registers the layers.
`Setup::layer` registers a plugin-wide layer, for the composer or everywhere.

- **Scope**: the surface, one of its nodes, the composer, or everywhere. A route's layer holds while no host dialog or
  overlay covers it, and a global one while no other plugin's overlay has the focus.
- **Binds.** A matching key calls the handler with `Event::Key`, which names the key that matched (`k` of `up,k`) and
  carries text only when no modifier but shift is held. `Handled::Pass` lets the key go on down the host's order.
  `Bind::command` takes the keys of a user keybind, such as `diff.next_hunk` (the config's, else the default), and
  `Read::shortcut` shows them.
- **`any`**: the layer hears every key before any other layer.
- **`paste`**: the layer may take a paste in its scope. Listeners hear pastes by priority, newest first among equals.
  A global `paste` hears one in the composer or a plugin surface before the host, and one elsewhere only if no host
  widget took it.
- What a handler asks for applies before the next event of the same read.

**Modes.** `Host::set_mode` puts the caller's mount (or the plugin) in a mode, in which only its layers of that mode
hold. The mode holds where it was set: the focused surface, else the composer for an owner with a composer layer,
else everywhere, never over a host dialog. It ends when the focus leaves its scope, when its owner ends, and on
`ctrl+c`.

**`ctrl+c`** is never a plugin's key, however a bind spells it. Before anything else it ends every plugin mode, drops
held keys, and mutes the plugins' layers at the focus until the focus moves. Then, unless a selection copies it or a
host dialog takes it, it closes one level of the plugin surface with the input: a focused overlay (its opener hears
`Closed`), else a focused panel, else a plugin route (back to the route before). Only with no plugin surface focused
is it `app.exit`'s. The draft stays, and rebinding `app.exit` changes none of this.

**Hold.** A bind with `hold` keeps the keys and pastes after it, at most 256, until its owner calls
`Host::release_keys`, 50 ms pass or the limit is reached. Then they are routed in order, minus those meant for a
focus that moved since. Presses are not held.

### Focus and fields

A box's `Interact` makes it focusable (`Host::focus`, `Host::blur`). An `Input` or a scroll with an id takes the
focus from `Host::focus` as from a click (feature `focus-input`): an input then gets typing, after the layers in
scope; a scroll scrolls on the arrows and page keys.

- `Read::focused` names the focused node, and a `LayerScope::Node` of it holds while it has the focus.
- A focused node rebuilt by a new tree keeps the focus; one the tree drops gives it to its surface, else the composer.
  A node in a hidden box takes none.
- A focus from a call the user did not cause (a wake, a reply) is taken too.
- A call may focus a node its mount does not show yet: the focus applies if the next view shows it and is dropped
  otherwise. So a command can open its dialog surface and focus a field in it.
- `Read::rect`, `focused` and `mode` read the running call's mount. A command's `focus` and `blur` act on the mount
  that holds the node.

### Pointer, scroll and input events

A box's `Interact` gives `Event::Pointer` for press, release, drag after a consumed press, wheel and drop, and a hover
background or `Event::Hover`; a text with an id and `hover_events` gives `Event::Hover` too. A capture ends with the
release, the node leaving, a focus move, a host dialog or a resize. A consumed press starts no text selection, runs no
click of the box, and gives the surface the focus unless the handler focused a node. While a host dialog is open no
pointer node hears anything. A drop says where the drag started (`Pointer::from`), which must be a node of the same
plugin.

The same handler hears `Event::Scroll` (a plugin step landed, or the user scrolled a scroll with `user_scroll`) and an
`Input`'s `Event::Change` and `Event::Submit`; their answer does not matter. A handler of the user's own input may
move the transcript, as a user's command may. It runs as its mount's call, so its requests end with the mount.

A handler or a select's search is a plugin call, timed and contained as any other. One that panics fails the plugin:
its layers, modes, capture, hold and overlays go, and the focus goes to the composer.

**Over the C ABI**, the manifest lists each surface's `handler` and `layers`, and the plugin's own `layers` and
`searches`. The host calls a handler as the request `input` and a search as `search`. The verbs and reads are host
requests (`open-panel`, `close-panel`, `overlay`, `close-overlay`, `focus`, `blur`, `set-mode`, `release-keys`,
`rect`, `focused`, `input-mode`) on the mount whose call runs; during `create` they answer an error. The `board`
example uses all of it.

### Rich selects

`Dialog::Select` with a `key` is a rich select. Shown again under its key, it changes in place, keeping its filter and
selection, and a pick does not close it.

- **Rows** may have an action, a footer color, a gutter (the host's spinner or a span), a `search_text` the filter
  matches, or `toggle`.
- **`toggle`** names a plugin the host enables or disables when the user picks the row (the host action
  `plugins.toggle`, `enter` by default), never when a command runs by name. Its title says `enable` or `disable`. A
  row cannot toggle its own plugin, the plugin manager, or a plugin that did not load. For a pending project plugin it
  is `approve or decline`: the host asks, then shows the select again.
- **Actions and binds** run with the selected row's value. An action is primary when it runs on the row, unless
  `primary` says otherwise; `rowless` runs with no row; `command` names a user keybind instead of `key` (the config's
  keys alone, so `none` turns it off); `disabled` dims it. Neither may be `ctrl+c`, `plugins.toggle` or a host select
  command, and one the host cannot bind is left out.
- **Shown again** with other keys, it is rebuilt with its filter and selection; with only other titles, hidden rows
  or `disabled`, it changes in place.
- **`size`, `focus`**: a size, and a row selected on open without `current`'s mark.
- **`search`** names a `Setup::search` that lists the rows for each query, the empty one on open, flat and in its
  order.
- **`query`** runs the action with the filter's text after `query_delay` ms, and the host filters nothing, as for a
  server search. `filterless` hides the filter, `empty` shows while no row does, and `note` is a line under the rows.

## The plugin list

`Read::plugins` lists the TUI plugins in the host's order: a unique key, the ID, the target, the origin (built in,
added, configured and not loaded, or external), the status (active, inactive, skipped, failed, pending, declined),
whether it has an activation, and whether it is slow and at what cost.

- **No error text**, because an error can hold another plugin's paths, data or secrets. The host shows it to the user
  alone, in an error view whose `plugin` names the entry.
- **`Setup::on_plugins`** runs once after a batch of changes (enabled, disabled, loaded, approved, declined, failed,
  skipped by a config edit, slow or no longer slow), never when nothing changed or only a slow plugin's cost did. A
  failure is a contained call named `on-plugins`.
- **Only the host changes the list**: a plugin offers a toggle row and the user picks it.
- **Over the C ABI** the change is the request `{"type": "plugins"}` and the read the host request
  `{"type": "plugins"}`. The pipe answers the read but not the change.

The plugin manager (`opencode.plugins`, `crates/tui/src/plugins/manager.rs`) is a plugin of this contract: a rich
select that follows `on_plugins`, with fetches for the server rows, check and update. While it has failed, the host
keeps a read-only `/plugins` whose manager row starts it again (`crates/tui/src/plugins/fallback.rs`;
[`F16-plugin-manager-fallback.md`](../parity/deviations/F16-plugin-manager-fallback.md)).

## Settings, images and bytes

The diff viewer (`opencode.diffs`, `crates/tui/src/plugins/diffs`) is the largest plugin of this contract: a panel and
a route with one view, cards in a windowed `List` of memoized items, `sticky` headings, `Diff` patches whose hunks are
anchors, a key layer, an overlay menu and host dialogs. It also uses:

- **Settings.** `Read::setting` and `Host::set_setting` read and save the host's named settings (`abi::SETTINGS`: the
  `diffs.*` keys of the TUI config). A value the setting does not take is not saved. Over the ABI: `setting` and
  `set-setting`.
- **Bytes.** With `Fetch::bytes` the reply is the body's bytes in base64 (`abi::base64`).
- **Image sizes.** `Read::image_size(bytes)` is the size the host's decoder gets, bounds included, or none where an
  image node would show nothing. `abi::image_size` reads only the header. Over the ABI: `image-size`, with base64.
- **Diffs and boxes.** `Node::Diff`'s `wrap` and `padding`, and the box builders `padding_sides` and `clip`. A sticky
  box paints over the siblings it is pinned above, as CSS's sticky does.

## Storage

`storage_key(key)` declares a key, stored as `plugin.<id>.<key>` in the TUI's storage. Only declared keys read and
write, and a key declared in setup works in setup.

- A value is an object or an array; the host ignores anything else.
- `storage_get` sees a write at once. The host writes the disk later, in order, and renders the claims with `local`.
  Queued writes reach the disk before the TUI exits.
- `storage_merge(key, fields)` sets fields in the latest stored object under the storage lock, so fields another
  client stored stay.

## Fetch

`fetch` sends a request through the host's client, with its credentials, to the server the TUI talks to now (a
managed service it follows across restarts).

- **The path** starts with `/` and stays on that server; one that would reach another origin, such as
  `/https://elsewhere/`, is refused before the credentials go on.
- **The reply** goes to the `on_reply` handlers on the UI thread, in order with the other effects, while its owner
  lives. It is the JSON body of any 2xx, `null` without a body, or with `bytes` a base64 string.
- **An error is text:** a declared server error's message (else its tag); `UnexpectedStatus: 404: <body>` for another
  status (the body trimmed and cut at 200 characters); `Transport: …` when the request could not be sent or would
  leave the origin; `MalformedResponse: …` when the body is not JSON.
- **A fetch from a failed setup or a dispose callback is not sent.**
- **IDs.** A fetch gets an ID only when its reply can come, and every ID gets exactly one reply. An ID is never 0.
- **Refusal.** The effect queue is bounded. While waiting effects fill it, or a dispatch chain is too deep, the host
  takes no fetch or `foreground`: `try_fetch` and `try_foreground` return an `Err` with the reason, the C ABI answers
  `OPENCODE_ERROR`, and a TypeScript fetch resolves as a failed reply. A fetch the host takes is admitted past the
  bound.

A fetch or `foreground` belongs to a mount or to the activation, the same on every carrier
([Ownership and cancel](plugins.md#ownership-and-cancel)). A Rust or C plugin whose manifest has `cancelled`
(`Setup::on_cancelled`, which the SDK's tasks register) gets `{"type": "cancelled", "id": N}` once for each request a
mount's close cancelled. Over the pipe the host tells the JS host as the mount closes, and the TypeScript `fetch`
rejects with an `AbortError` ("the fetch was cancelled: the mount that asked for it closed"). A TypeScript handler's
call ends at its first `await`: what it asks for after that is the activation's, even if the mount has closed.

## Events

`on_event(types, run)` gets the server events of those types, after the store applied their batch, while the plugin
is active. The streaming deltas (`session.text.delta`, `session.reasoning.delta`, `session.tool.input.delta`,
`session.compaction.delta`) never arrive there. If the UI thread falls more than 1024 events behind, the oldest are
skipped.

`on_deltas(run)` gets every delta the store applied since its last call (never one from before it was registered),
oldest first, at most once a frame, before the frame, and never with none. A store batch's deltas come in one call,
also for a session whose messages the TUI has not loaded. While a plugin has the handler, the store keeps at most
4096 untaken deltas and drops the oldest. Unlike TypeScript's `data.on`, which runs once a delta, a plugin that counts
deltas counts the slice.

## Fence keys

`Fence::key` names a block while it changes, across renders that return `Lines` or `Keep`. `on_fence_gone(run)` gets
each key once, after a block that showed `Lines` or `Keep` goes or falls back to the code view. A block that only
returned `Code` sends nothing, and the host sends `FenceGone` only to a plugin with the handler.

## Threads and the waker

`Setup::messages(run)` returns a `Sender` (`Clone`, `Send`) for the plugin's threads. The host runs `run` on the UI
thread, one call a message, then renders the plugin's claims and surfaces again. Each plugin has one mailbox of 256
entries (`BOUND`). `send` never blocks: it queues the message, or hands it back as `Full`, or as `Closed` once the
plugin left `active` (and what waited is dropped). `replace(key, message)` replaces the message waiting under `key`,
so a flood of progress holds one entry. Over the C ABI messages are JSON.

`Setup::spawner()` starts named threads (`<id>:<name>`) with a `Stop` flag, set when the plugin leaves `active`, and
catches their panics: the host fails the plugin. A thread cannot be killed.

`Waker::wake` (from `Setup::waker()`) is a redraw hint, not a message. Wakes before the host handles one count once,
and the last is never lost. On the UI thread the host runs `on_wake`, then renders with `woken`. Disposal revokes
every clone of the waker, waiting for wakes in progress, before `on_dispose` runs. Stop the threads in `on_dispose`.

## Lifecycle

- **Load** reads the ID from `describe` and runs no setup. A null `describe`, or one that names no ID, is refused. A
  build whose ID another external plugin has is refused ("plugin ID … is already registered") until the ID is free.
- **Activation.** Setup (`create`) runs on each activation. Deactivation, unloading, a reload and the TUI's exit
  destroy that instance, so a plugin `cli.json` disables starts nothing.
- **Disposal** revokes the waker, then runs the `on_dispose` callbacks, last registered first, each even when another
  panics. Their effects run, except a fetch (not sent) and a dialog (its activation is gone).
- **A failed setup** (an `Err` or a panic) runs the `on_dispose` callbacks it registered, and the plugin is `failed`,
  with a toast. Enabling it again runs setup again.
- **A panic** never unwinds across the boundary: the shims catch the plugin's, the host's callbacks catch the host's,
  and the shims silence the plugin's panic hook, which would print over the TUI. An instance whose call panicked is
  never called or destroyed again, so its `on_dispose` callbacks never run.
- **Reload.** `Loader::reconcile` loads new and changed builds (by content digest), unloads removed ones, and remounts
  the route when anything changed. A failed build of an inactive or panicked plugin replaces its error.
- **Libraries are never unloaded,** because a plugin's code must outlive every pointer into it; a reload leaks one
  mapping.
- **Order.** A plugin keeps its claim order and fence precedence across reloads and toggles. An external plugin with a
  built-in's ID takes the built-in's place, and unloading it brings the built-in back as it was.

## The JS host

The JS host (`crates/plugin/src/pipe`) is one Bun process for every TypeScript TUI plugin, found and started as
[TypeScript plugins](plugins.md#typescript-plugins) describes. The cargo feature `ts` (of `opencode-plugin`,
`opencode-tui` and `opencode-cli`) gates it, with the compatibility layer and the embedded `host.ts` and `compat.js`.

Bun's `bunfig.toml` holds only `[install] auto = "disable"`, and `--no-install` wins over a user's bunfig. The
environment allowlist keeps what locates the user, the language, the proxy, the terminal (`TERM`, `TERM_PROGRAM`,
`COLORTERM`, `TMUX`, …) and the client's own variables, and drops every `BUN_*`, `NPM_*` and `NODE_*`.

### Loading a plugin

The JS host loads a directory's TUI module as the TypeScript client does (`package.json` `name` and `exports`, else
`tui.ts` and its kin) by file URL.

- Setup runs only once the loader knows the plugin is enabled.
- Each load imports the plugin's modules afresh. A reload's setup runs on a candidate, and the running version answers
  until the candidate's setup returns, and stays if it throws.
- A missing package fails the load: "it imports the package '<name>', which is not installed with the plugin, and
  opencode-native installs nothing".
- An npm entry resolves as the TypeScript client's `Npm.resolve` does (`crates/plugin/src/loader/npm.rs`):
  `<cache>/npm/<key>/<newest generation>/node_modules/<name>`, keyed by the spec's text (`name@latest` for a bare
  name). It is not watched.
- A plugin's files are read off the UI thread, and it is listed as starting until that walk ends. A global plugin's
  build is its own files plus its dependencies by version (each package's `package.json`, and the lockfiles).
- A project's plugin runs from a staged copy of the approved files and imports nothing outside it. Its approval
  hashes every file, hidden ones and `node_modules` included. Safe mode holds a TypeScript plugin as it holds a
  library.

### The compatibility layer

`crates/plugin/src/pipe/compat`, bundled into `compat.js` by `script/gen/js-host.ts`, gives setup the TypeScript
client's context. Imports of `@opencode/plugin/tui`, `solid-js`, `solid-js/store`, `@opentui/solid` (and its JSX
runtimes) and `@opentui/core` get the layer's, also from a package's own `node_modules`.

- A slot claim, a route and the session panel are surfaces. Each mount renders the JSX with Solid's universal
  renderer into plain nodes, which its view reads into a contract tree: boxes with borders, padding, margins, sizes
  and absolute positions, text with spans, scroll boxes, Markdown, code, fields. A click runs the node's pointer
  handler.
- `ui.dialog.show` is a dialog surface whose scroll boxes scroll and inputs are fields.
- `data` and the small reads (`ui.router.current`, `keymap.pending`, tabs, the model) are pushed snapshots.
- The verbs (`keymap.dispatch`, `ui.toast`, dialogs, navigation, storage writes) are effects, and `client` is the
  generated client over the host's `fetch`.
- `markdown.registerCodeBlockRenderer` is a fence claim.

What does not map warns once in a toast and does nothing, or throws in the render that used it
([`F16-v2-compat-layer.md`](../parity/deviations/F16-v2-compat-layer.md)). An async setup hands the plugin over at its
first wait; what it and its components register after that arrives as a new manifest, taken as a reload of the
registrations.

Under `Symbol.for("opencode.carrier")` the context also exposes the carrier itself:

- `surface(name, place, view, { palette, notify, on, layers, mounts, unmount })`, whose views return contract trees
  (`memo`, `content`, `release`, `visible`, a keep of the root). A view's input has no `changed`: the JS host views
  again when what the plugin watches changes.
- `layer(layer, handler)`.
- `claim(target, view)`, a renderer claim: `view(part)` returns a tree, `null` to decline, or throws to fall the part
  back; the returned function ends the claim.
- `command`, `on`, `storage(keys)`, `effect` (any host request), `watch`/`unwatch`/`read` (snapshots, at most 128),
  `invalidate`, `fetch`.

A renderer claim answers after the frame: the host's code view shows until the first tree, then the last tree while a
newer part is in flight. A renderer that throws falls that part back, and the plugin stays active. A plugin has at most
256 claims, a fence over 256 KiB keeps the code view, and a part waits unsent while the queue to the JS host is backed
up.

### The wire

The protocol runs both ways on the JS host's standard input: a socket pair on Linux and macOS, and on Windows a
duplex named pipe that only this JS host can hold (a random name, a single instance, this user's alone, local, its
client connected before the JS host starts). Nothing a plugin writes can break it.

A plugin's `console` and `process.stdout` go to the JS host's standard error, which the client logs line by line. A
direct write to file descriptor 1 is logged too, escaped and attributed to the plugin that ran: at most 10 records a
second and 64 KiB in all for one JS host, the rest counted. (The TypeScript client sends those bytes to the
terminal.) A plugin that hands the host something that is not JSON (a `BigInt`, a cycle) fails alone.

### Timing

No frame waits for the JS host.

- **Events** (commands, events, input, replies) cross with a sequence number. The JS host acknowledges each, says when
  it starts one, and answers once the handler returned and its views were sent, with its effects (at most 256), which
  apply then, in order. A handler that throws fails its plugin.
- **Input** cannot wait a round trip, so the host answers from what the plugin declared: a bind's key, a paste to a
  paste layer and a pointer event on a node that asks for it are consumed, and the handlers' answers are advisory. A
  key for an `any` listener that can take one now is held, as a key command's is, until the handler answers `consume`
  or lets it go on. A handler's effects are its mount's.
- **Trees** are revisions of a mount, one in flight. The host adopts a revision in its next frame, or refuses it and
  gets a whole one. Until the first tree a placeholder keeps the rows its key had (or one row); after that the last
  tree shows.
- **Reads** are snapshots of what the plugin watches, pushed before each event, after each call's effects and at each
  change. A large read goes in parts. One past the plugin's content room or the queue's room is not pushed: the read
  gives nothing (`carrier.readError(key)` says why) until the next refresh. There is no canvas draw.
- **Hold.** A command with `hold`, and a key a JS command or listener may decline, holds the keys and pastes typed
  after it until its effects applied, or 50 ms. Past 64 held it lets everything go on in order; none is dropped. Input
  to a mount that closed meanwhile goes with it. `ctrl+c` ends the hold, drops what it kept, and reaches the host.

### Supervision

- **To the JS host,** 1 MiB is queued, then an 8 MiB overflow that drains as it reads. Past that a message is refused
  (a handler's call is answered with nothing). A message that settles the JS host's work (a reply, a call's effect
  answers, a cancellation) is never dropped: past the overflow it waits in a reserve as large again.
- **From the JS host,** past 512 unread messages or 8 MiB, or 8 unread trees, its write blocks. A control message is
  at most 256 KiB and a tree 8 MiB; a larger message comes in pieces. What a plugin sends before it is registered is
  held within 256 messages and those 8 MiB.
- **Ending it.** A JS host is hung when it owes an answer and sends nothing for 1 s (10 s for a started load or
  setup); a queue that moves is not hung. A hung JS host, or one over 512 MiB resident, is killed with its process
  group. The plugin whose work it was running fails, as does one that
  flooded the host with effects; a memory kill names nobody. The other plugins are set up again on a new JS host with
  new state, their surfaces keeping their last trees, and get the calls the old one never started, in order, once
  each. Their modes end. Three kills in a minute fail every plugin on it.
- **With the client.** The JS host dies with the client however it ends, and takes what its plugins started: when its
  input ends, on Linux on the parent-death signal, and everywhere from a thread that watches its parent. On Linux it is
  a child subreaper, so a process a plugin started stays its descendant. On macOS only its process group is killed.
  On Windows a job holds it and everything it starts, and closes with the client.

## The host side

`crates/plugin` holds the `Registry`, slot resolution, the loader, and the renderer that turns nodes into widgets.
Its `Host` trait is what every carrier's adapter calls. The TUI implements it once, in
`crates/tui/src/plugins/host.rs`, the only code of the crate that sees the TUI.

- **Built-ins.** `Registry::new` takes `Builtin::Plugin(abi::Plugin)`, or `Builtin::Abi(abi::Plugin)` for the same
  plugin through the C ABI's byte shims, which the carrier tests use. The TUI's built-ins are in the TypeScript
  client's order, the diff viewer last. Mermaid and LaTeX come from the binary crate, so `opencode-tui` does not depend
  on them, and none of them depends on OpenTUI. The linked host serves every optional feature (`abi::FEATURES`).
- **Mounts.** `host::slot(tui, parent, path, input, content)` mounts a slot: before, prepend, the host's own content
  (skipped when a claim replaces it), append, after. A `SlotMount` or `RouteMount` syncs with `abi::Changed`, built
  from each store batch.
- **Limits.** `crates/plugin/src/limits.rs` bounds trees, `contain` times every call, and `crates/cli/src/contain.rs`
  restarts the client after a native crash.

## Tests

The tests build each native example once a run into `target/sample-plugin`. The loader's unit tests are in
`crates/plugin/src/loader/native/tests.rs`, and the TUI's in `crates/tui/tests/all/plugins.rs` and the `plugin_*.rs`
files beside it:

- `plugin_carriers.rs` runs the `board` source linked, through the C ABI's byte shims, and as a loaded `cdylib`, and
  compares frames, toasts and status at every step.
- `plugin_ownership.rs` runs one table of request ownership on all four carriers.
- `plugin_published.rs` and the P-APP scenarios under `parity/scenarios/P.8` run published TypeScript plugins (pinned
  in `parity/plugins/npm`) unmodified on the JS host, and compare their cells and requests with TypeScript's.
- `crates/plugin-abi/tests/sdk.rs` checks that the SDK's README and [`plugins.md`](plugins.md) show the examples as
  they are, and that they build on the SDK alone.
- `parity/machines/plugins.json` is a state machine of a plugin's life that both clients read
  ([`testing.md`](testing.md#the-plugin-state-machine)).

## Conformance

The conformance suite holds the C ABI still for every binding. `crates/plugin/conformance/scripts.json` lists
scripted sessions: activation and its end, commands and their host requests, surfaces with content and memoized
subtrees, the mailbox and a wake, a canvas, scroll verbs and reads, input, searches, renderer claims of a tool call
and a fence, dialogs, the plugin list, a panic, a refused tree, a failed setup, and an overrun.

Each is recorded from `crates/plugin/examples/conformance` (the reference, called through the SDK's byte shims) into
`crates/plugin/conformance/transcripts.jsonl`: every request and reply across the C ABI on the UI thread, with what
the user sees at each `observe` step. Only `CONFORMANCE_WRITE=1` on the loader's `conformance::` tests writes it and
`versions.jsonl`.

A transcript keeps what the host sends as exact JSON, except that mount generations and content handles are numbered
by first appearance. It keeps what the library sends as the host decodes and re-encodes it, so field order, defaults
and unknown fields do not count. A canvas's list is kept as hex bytes. Statuses and error and panic texts compare
exactly. `crates/plugin/src/conformance/tests.rs` checks each transcript from both sides:

- the reference records it again, so a change to what crosses fails until the file is rewritten;
- the host runs the script against a plugin that answers from the transcript, also posing as a later minor (a longer
  table, an unknown field in every object, an unknown request in each call);
- a fake host drives the reference as a `cdylib`, and `examples/conformance/plugin.c` (symbols hidden, warnings as
  errors), through every transcript of their major, also as a later-minor host;
- changing or dropping any part of any entry fails the side that writes it.

`the_version_gate_is_exact` runs a grid of tables (majors 0 to 3, minors around the host's, `requires_minor`, short
tables, failing or unreadable `describe` answers, unknown features and fields) through the host's gate, checks each
verdict against the header's rule, and pins the messages in `versions.jsonl`. The tap that records transcripts also
feeds a protocol machine written from `opencode_plugin.h` (`conformance::Protocol`): one call at a time, host requests
only inside a call, no call into a failed or destroyed instance, read-only renders, and only requests the contract
names. Every seeded model of the TUI's tests runs under it.

A new request or surface kind adds a transcript, not harness code: it goes into the conformance plugin in Rust and in
C and into a script, and the writer records it. To prove a binding in another language, port the conformance plugin
and run `opencode-native plugin test <library> --conformance`.
