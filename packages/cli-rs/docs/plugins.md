# Plugins

A plugin adds commands, keys, parts of the screen, pages, dialogs and renderers to `opencode-native`. This guide
covers the model, writing a plugin in Luau or TypeScript, waiting, limits, and how the client finds and runs
plugins. [`plugin-abi.md`](plugin-abi.md) is the reference, and `cargo doc -p opencode-plugin-abi --open` documents
every type. Paths are relative to `packages/cli-rs`.

## The model

A plugin never holds a widget, the TUI or the store. It registers what it adds in a `setup` function, reads through
a read handle, asks for effects through a host handle, and returns trees of nodes that the host draws. That interface
is the *contract*: the crate `crates/plugin-abi` (`opencode-plugin-abi`, ABI 2.0), whose messages have one JSON
Schema, `crates/plugin-abi/schema/v2.json`. A *carrier* runs a plugin against it:

| Carrier | A plugin is | A call crosses as | Host code |
| --- | --- | --- | --- |
| Linked Rust | an `abi::Plugin { id, setup }` compiled into the client | Rust values | `Builtin` in `crates/plugin/src/lib.rs` |
| Luau | a directory with `plugin.toml` and `init.luau` | Luau tables, in a sandboxed VM for each activation | `crates/plugin/src/luau` |
| Pipe | a TypeScript TUI plugin, unmodified | framed messages to one Bun process for all TS plugins, the *JS host* | `crates/plugin/src/pipe`, and `loader/requests.rs` |

- **Every built-in is a linked plugin on the public contract** (`crates/tui/src/plugins`, `crates/latex`,
  `crates/mermaid`), the plugin manager (`/plugins`) and the diff viewer included.
- **The first two run on the UI thread, inside the frame.** No frame waits for the JS host, so a TS plugin's tree
  and reads arrive a frame or more late.
- **A TS plugin gets the context the TypeScript client gives it** from a compatibility layer, which turns its JSX
  into contract trees. [`F16-v2-compat-layer.md`](../parity/deviations/F16-v2-compat-layer.md) lists what does not
  map.
- **The JS host and Luau are cargo features**, `ts` and `luau` (of `opencode-cli`, `opencode-tui` and
  `opencode-plugin`), both on by default. `OPENCODE_PLUGIN_JS=0` and `OPENCODE_PLUGIN_LUAU=0` turn them off at run
  time, and `--no-plugins` loads no external plugin at all for one run ([Failures](#failures)). A plugin of a missing
  carrier is listed as skipped.
- **Native plugin libraries do not load.** A `plugin.so` (`plugin.dylib`, `plugin.dll`) or a configured library is
  listed as skipped. Third-party native code may return as a supervised helper process; it will not run in the
  client's process.

`setup` runs once for each activation. The same registrations on each language:

| What | Rust (`Setup`, `Host`) | Luau (`setup`, `host`) | TypeScript (`context`) |
| --- | --- | --- | --- |
| A command: palette entry, `/slash`, keybind | `setup.command(Command::new(..), run)` | `setup:command({ name = .. }, run)` | `keymap.layer(() => ({ commands }))` |
| Keys in a scope or a mode | `setup.layer(Layer, handler)`, `Surface::layers` | `setup:layer(layer, handler)` | a layer's `mode`, `target` and each command's `bind` |
| A slot claim | `setup.slot(Placement, render)` | `setup:slot({ path, kind }, render)` | `ui.slot({ append: path, render })` |
| A route, a page of its own | `setup.route(name, render)` | `setup:route(name, render)` | `ui.router.register(page)` |
| A surface: a keyed tree with its own input, as a route, slot, panel, overlay or dialog body | `setup.surface(v2::Surface)` | `setup:surface(spec, view, handler)` | each slot, route, panel and `ui.dialog.show`, through the compat layer |
| A dialog | `host.dialog(Dialog::..)` | `host:dialog({ type = .. })` | `ui.dialog.prompt`, `select`, `confirm`, `alert`, `show` |
| Storage, by declared key | `setup.storage_key`, `read.storage_get`, `host.storage_set` | `setup:storageKey`, `read:storageGet`, `host:storageSet` | `storage.store(key, ..)` |
| Server events | `setup.on_event(types, run)`, `setup.on_deltas` | `setup:onEvent(types, run)` | `data.on(type, ..)` |
| A code fence or tool call renderer | `setup.code_block`, `setup.claim` | `setup:codeBlock` | `markdown.registerCodeBlockRenderer` |
| Mount and disposal hooks | `on_mount`, `on_route_mount`, `on_dispose` | `onMount`, `onRouteMount`, `onDispose` | the cleanup `setup` returns |

Every call into a plugin gets one of two handles:

- **`Read`**: sessions, messages, models, the route, theme colors, the composer, tabs, storage. Reads are pure, and
  all reads of one call see one snapshot of the store. A render or a view gets only this.
- **`Host`**: the reads, plus effects such as a toast, a dialog, a navigation, a fetch, a storage write or a focus.
  Effects run in order once the outermost call into the plugin returns, so a plugin never re-enters itself, and a
  call that panics leaves none.

A render reads and returns data; it never draws. A slot or route render returns `Render::Keep`, `Hide` or
`Show(node)`. A surface's view returns a tree of `v2::Node`, which the host reconciles by `id`: a node whose id and
kind stay keeps its widget and its state (a scroll offset, the focus, half-typed text). `View::memo` returns
`Node::Keep` for a subtree whose input has not changed, so neither side rebuilds it. A render runs again when
something it could show changed, and `Changed` says what. [When claims render](plugin-abi.md#when-claims-render) and
[Surfaces](plugin-abi.md#surfaces) have the rules.

## Writing a plugin

The same plugin twice: a command, in the palette and as `/hello`, that shows a toast, and a `hello` at the end of the
home screen's footer that runs the command when clicked. Each file is in the repository, and a test loads and runs
it. The built-ins are the same contract in Rust (`abi::Plugin { id, setup }`), linked into the client.

### Luau

`crates/plugin/examples/luau/hello/init.luau`:

```lua
--!strict
-- The quick start: a command in the palette and as `/hello`, and a line in the home footer that runs it.
local plugin = require("@opencode/plugin")

return plugin.define(function(setup)
    -- A command in the palette and as `/hello`.
    setup:command({ name = "hello.greet", title = "Say hello", slash = "hello", palette = true }, function(host)
        host:toast({ variant = "success", message = "Hello from a plugin" })
    end)
    -- A line at the end of the home screen's footer; a click runs the command.
    setup:slot({ path = "home.footer" }, function()
        local text = plugin.text({ plugin.span("hello", { fg = "text.muted" }) }, { on_click = plugin.click("hello.greet") })
        return plugin.show(text)
    end)
end)
```

Beside it, `plugin.toml`:

```toml
# The quick start in Luau: a command and a footer line that runs it.
id = "example.luau-hello"
name = "Hello"
version = "0.1.0"
contract = "2.0"
description = "A command in the palette, and a line in the home footer that runs it"
```

Copy the directory to `~/.config/opencode/plugins/hello/`. There is no build, and the files run on every platform.
`crates/plugin/src/luau/opencode/plugin.luau` is a typed stub of `@opencode/plugin`; a `.luaurc` that aliases
`opencode` to its directory (as `crates/plugin/examples/luau/.luaurc` does) lets `luau-analyze` and luau-lsp check a
plugin, and `bun run check:luau-types` checks every Luau plugin in the repository.

### TypeScript

`crates/plugin/examples/pipe/hello/tui.tsx`:

```tsx
/** @jsxImportSource @opentui/solid */
// The quick start as a TypeScript TUI plugin, which the JS host runs.
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "example.ts-hello",
  setup(context) {
    // A command in the palette and as `/hello`.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "hello.greet",
          title: "Say hello",
          palette: true,
          slash: { name: "hello" },
          run: () => context.ui.toast.show({ variant: "success", message: "Hello from a plugin" }),
        },
      ],
    }))
    // A line at the end of the home screen's footer; a click runs the command.
    context.ui.slot({
      append: "home.footer",
      render: () => (
        <text fg={context.theme.text.muted} onMouseUp={() => context.keymap.dispatch("hello.greet")}>
          hello
        </text>
      ),
    })
  },
})
```

Copy the file to `~/.config/opencode/plugins/hello/tui.tsx`, or publish it to npm and run
`opencode-native plugin add <name>`. It needs Bun ([TypeScript plugins](#typescript-plugins)).

### Examples

Under `crates/plugin/examples`:

- `luau/hello` and `luau/counter`: the quick start, and a sidebar counter with storage, a command, a server event, a
  fence renderer, a confirm dialog and a module of its own;
- `pipe`: fixtures for the JS host's tests.

The separate `plugins` repository ports ten published TS plugins to Luau. Four show the most: queue-manager (chained
dialogs and ordered writes as one task), session-usage (paged typed calls, a tick), session-manager (a route with two
key layers, a search field, a debounce) and goal-plugin (a sidebar read from tool results, with a tick that runs only
while the sidebar shows).

## Waiting: tasks, `await` and timers

A handler often waits: for a dialog's answer, a server reply or a timer. A *task* lets it wait in a straight line,
as `async` code does in TypeScript, while every stretch of it still runs inside a host call on the UI thread.

- **A task has no thread.** When it waits it returns to the host, and the answer (a reply, a dialog's answer or
  close, a timer, a wake) is another call into the plugin that resumes it.
- **A waiting task costs nothing.** Each stretch between waits is part of one host call, timed and bounded as any
  call is ([Limits](#limits)). What it asks for takes effect when that call returns.
- **Tasks interleave at their waits,** as `async` calls do.

**Rust**, for the built-ins (`crates/plugin-abi/src/task.rs`). `Setup::tasks()` returns a `Tasks` handle, and
`tasks.spawn(host, f)` starts a task. It is a plain `Future` with real wakers, so other crates' combinators work;
`task::join_all` waits for several. Its `Cx` has the waits (`select`, `prompt`, `confirm`, `alert`, `fetch`,
`foreground`, `sleep`, `blocking`, and the typed `call` and `send`). `Cx::with` lends the current call's host to a
closure; the borrow cannot be held across a wait. This is the module's own doc-tested example:

```rust
fn setup(setup: &mut Setup) -> Result<(), String> {
    let tasks = setup.tasks();
    setup.command(Command::new("x.clear").palette(), move |host, _| tasks.spawn(host, clear));
    Ok(())
}

async fn clear(cx: Cx) {
    if cx.confirm(Confirm::ask("Clear?", "Clear the list?")).await != Some(true) {
        return;
    }
    match cx.fetch(Fetch::new("DELETE", "/api/x")).await {
        Ok(_) => cx.with(|host| host.toast(Toast::new(Variant::Success, "Cleared"))),
        Err(error) => cx.alert(Alert::new("Clear failed", error)).await,
    }
}
```

**Luau** (`crates/plugin/src/luau/plugin.luau`). Every handler called with a `host` is already a task. A waiting
call parks the coroutine and returns the answer: a request gives `value, nil` or `nil, err`, a dialog its answer or
`nil`. `plugin.spawn(f)` starts another task and `plugin.all({ f, .. })` waits for several. A render, a view and
`setup` are not tasks, and a wait there fails. The same handler, which `the_guides_luau_wait_runs_as_written` runs
from this file:

```lua
setup:command({ name = "x.clear", palette = true }, function(host)
    if not host:confirm({ title = "Clear?", message = "Clear the list?" }) then
        return
    end
    local _, err = host:fetch({ method = "DELETE", path = "/api/x" })
    if err then
        host:alert({ title = "Clear failed", message = err })
    else
        host:toast({ variant = "success", message = "Cleared" })
    end
end)
```

**TypeScript** awaits promises as in the TS client (`await context.ui.dialog.confirm(..)`); each is an effect whose
answer comes in a later message.

Both SDKs send typed API calls, generated from the server's OpenAPI document, so a wrong path or field fails the
build or the type check: `cx.call(client::session_inbox_list(&input)).await?` in Rust, and
`plugin.client.session.inbox.list({ sessionID = id })` in Luau.

### What ends a wait

| When | The task |
| --- | --- |
| Its dialog is answered | goes on with the answer |
| Its dialog closes any other way (escape, the backdrop, another dialog) | goes on with `None` (Rust) or `nil` (Luau); a confirm answers `false` on escape |
| Its reply comes | goes on with the body or the error |
| The mount that owns its request closes first | the request is cancelled, and the task goes on once with the error `cancelled` (`task::CANCELLED`) |
| The plugin is disabled, fails or is replaced, or the client exits | is dropped and never goes on; in Rust its destructors run |

### Ownership and cancel

A fetch, a foreground program and a timer are *requests*, and each belongs to what asked for it:

- **A mount's.** A request from a mount's call (a command of the route it shows, a handler of its input) is the
  mount's. Once the mount closes, an unsent request is not sent, a program does not start, and a reply is dropped,
  even when the surface opens again under the same key.
- **The activation's.** Every other request (from `setup`, a global command, an event, a wake, a mount's begin and
  end notification) is the activation's, and its reply comes unless the plugin is disposed first.
- **A task keeps the owner of the call that started it** (`Host::owner`), before and after every wait, and so does a
  task it starts. A task a mount's handler started ends with the mount; an activation's task stays the activation's
  even when a mount's call wakes it.
- **Cancel is told once:** as the error above in a task, in `Setup::on_cancelled` for a Rust plugin without tasks,
  and as an `AbortError` in TypeScript.

`plugin_ownership.rs` in `crates/tui/tests/all` holds these rules on all three carriers.

### Timers

A timer is a request (`Host::try_timer`) on the host's clock, owned and cancelled as a fetch is.

| | Rust | Luau |
| --- | --- | --- |
| Wait once | `cx.sleep(duration).await`: `Ok(())` or the error | `plugin.sleep(ms)`: `true`, or `nil, err` |
| Tick | `tasks.every(host, period, \|cx\| async { .. })` until the future gives `ControlFlow::Break` | `plugin.every(ms, function(host) .. end)` until it returns `false` |

- A delay is at least 20 ms (`MIN_TIMER`). In Luau it keeps fractions (`plugin.sleep(20.9)`), `math.huge` never
  wakes, and a delay that is not a positive number is the minimum.
- At most 32 timers of a plugin wait at once (`MAX_TIMERS`); one more fails its sleep. A sleep dropped early, such
  as the loser of a race, releases its timer.
- `every` is a sleep in a loop: a late tick is one tick, and an `every` a mount started ends with the mount.
- A tick that changes nothing draws no frame. A tick that asks for no paint closes its frame 17 ms later
  (`IDLE_CLOSE`), so each tick is judged alone against the frame budget and cheap ticks do not add up to a slow
  plugin.
- TS plugins use the JS host's own `setTimeout` and `setInterval`.

## Limits

A plugin is code the user chose to run, and a Luau plugin runs in the client's process, so none of this is a security
boundary. The limits keep one plugin from freezing or starving the client, and name the culprit.

| What is bounded | Linked | Luau | Pipe (TS) |
| --- | --- | --- | --- |
| Time in one frame | 1 ms a plugin, 4 ms for all. Over it in more than 12 of its last 120 frames, the plugin is slow, which the user is told once a session | the same | no frame waits |
| One call | an external plugin over 100 ms of CPU time fails when the call returns; a built-in's overrun is logged as a host bug | the VM's interrupt stops the call at 100 ms of CPU time, and the plugin fails | a JS host that owes an answer and is silent for 1 s (10 s for a load or setup) is restarted; the plugin it was running fails |
| A call that never returns | a built-in's bug: nothing stops it | stopped by the interrupt | as above |
| Memory | the client's | 32 MiB of heap a VM; 1 MiB of sources | 512 MiB resident for the JS host |
| One message | none: nothing crosses | 320,000 keys and values, 32 MiB of strings, 128 levels of nesting | 256 KiB a control message, 8 MiB a tree; 512 unread messages and 8 unread trees |
| Waiting work | 256 tasks, 32 timers, 4 `blocking` threads, 64 unanswered dialogs | 256 parked tasks, 32 timers, 64 dialogs | 256 effects a call, 128 watched reads |

On every carrier, a tree may make the host build at most 20,000 nodes and 3,000 rows, 1 MiB of text a node and 32 MiB
of content a plugin (`crates/plugin/src/limits.rs`); the node past a limit shows a placeholder, and the rest draws. Storage is 128 keys a
plugin and 256 KiB a value. At most 1,024 effects run in one frame for all plugins (`FRAME_EFFECTS`).

The time limits are `Limits` in `crates/plugin/src/contain/mod.rs`, and `OPENCODE_PLUGIN_LIMITS` overrides them, as
in `frame=2ms,overrun=250ms`. The Luau sandbox (`crates/plugin/src/luau`) has no file system and no `loadstring`, and
`require` reaches only the plugin's own files.

## Running plugins

### Where plugins are found

In the places the TypeScript client looks, in this order:

1. Each subdirectory, or link to one, of the `plugins` directories: the global one (`~/.config/opencode/plugins`, or
   `$OPENCODE_CONFIG_DIR/plugins`), then each `.opencode/plugins` from the project root (the nearest directory with
   `.git` or `.hg`) down to the working directory.
2. The TUI parts of the server's active plugins (`GET /api/plugin` with `features.tui`). One whose package or path
   does not resolve is left out.
3. Each entry of `plugins` in the global `cli.json` that names no built-in: a string, or
   `{ "package": …, "options": { … } }`. A local path is absolute, starts with `./` or `../` (from the config
   directory), or is a `file://` URL. `~` is not expanded.

Targets merge by local path; a later entry replaces an earlier one in its place. The target decides the carrier:

- a shared library, or a directory with `plugin.so` (`plugin.dylib`, `plugin.dll`): none, it is listed as skipped;
- a directory with `plugin.toml`: Luau;
- any other directory, and an npm package: the JS host.

An npm spec (`name`, `name@1.2.3`, a range, a tag, `@scope/name`, a git spec) resolves to the package the TypeScript
client installed in its cache. The client installs nothing: a spec missing from the cache is skipped with a hint to
run `opencode-native plugin add <spec>`.

**Enabling and disabling.** A `plugins` entry `-<id>` disables plugins by ID; `*` and `prefix.*` select several, and a
later entry without `-` enables them again. The entries after a plugin's own (all of them, for a discovered plugin)
decide whether it starts enabled. `opencode.*` IDs are the built-ins. An external plugin with a built-in's ID replaces
it in its place until it is unloaded. A toggle in `/plugins` lasts until the TUI exits and is not saved.

### TypeScript plugins

The JS host is one Bun process for all TypeScript plugins, started when the first one needs it. Bun is the first of:

1. `OPENCODE_BUN`, an absolute path;
2. the `opencode` binary of a local server (a background service or standalone server, not `--server`), run as the
   Bun it embeds (`BUN_BE_BUN=1`), when that Bun is 1.4.0 or newer. The client finds that binary from the server's
   process on Linux and Windows;
3. the `opencode` installed beside the client, for a remote server too;
4. where the server's binary is unknown, the first `opencode` on `PATH` that answers as Bun (by real path, so a
   version manager's shim is passed over);
5. `bun` on `PATH`.

Only absolute `PATH` entries outside the project count. Without a Bun, TypeScript plugins are skipped and `/plugins`
says why.

Bun runs in a private directory with `--no-env-file`, `--no-install`, its own `bunfig.toml`, and an allowlisted
environment, so nothing of the project loads as it starts and nothing is installed. A plugin that imports a package
its directory does not hold fails to load. The log has each failure with the stack the plugin threw, and its
`console` output as `js host: …` lines. `OPENCODE_JS_HOST_TRACE=<file>` appends every frame the JS host reads and
writes. [The JS host](plugin-abi.md#the-js-host) has the protocol.

### Approval of a project's plugins

A plugin in a project's `.opencode/plugins` runs only once the user approves it, whatever its carrier; the TypeScript
client loads it at once ([`F16-project-plugin-approval.md`](../parity/deviations/F16-project-plugin-approval.md)).
The global directory and `cli.json` need no approval, because a project cannot write them.

- **Until approved, the plugin claims nothing** and does not replace a built-in. The loader hashes its files and runs
  nothing. `/plugins` lists it `pending` under its directory's name, and a toast "Plugin needs approval:
  <directory>" says so once a build.
- **Enter on its row asks "Run project plugin?"** with what would run and the start of its SHA-256. Decline is the
  default button and lists it `declined` until the build changes. Escape, Ctrl+C, the header and the backdrop decide
  nothing. Enter on a declined row asks again.
- **A decision covers what the user was shown:** the directory and a SHA-256 of every file in it, and a copy of the
  approved files is what runs. A changed build is pending again, and a running build of it stops.
- **Decisions are kept in `plugin-approvals.json`** in the client's state directory, written under a lock as a private
  file. A store inside the project, at a relative path, or in a directory other users can write is not used, and
  decisions then last only as long as the TUI. A store that cannot be read approves nothing. Remove an entry, or the
  file, to forget a decision. Forgetting does not undo what approved code already did with the user's permissions.

### Reload

The TUI watches the `plugins` directories, each plugin directory and the directory of each configured path, and
loads a new build 100 ms after the last change (`OPENCODE_FILEWATCHER_DISABLE` turns this off). The new build starts
before the running one stops. If it fails to load or set up, the running version stays and `/plugins` says
`… (previous version still active)`. A plugin keeps its place among the claims across a reload and a toggle.

### Failures

A panic, a Luau error or a thrown exception fails that plugin alone. It is not called again, and none of the failed
call's effects apply. Its commands leave the keymap, its fences fall back to the code view, and its slots and routes
draw empty or the host's fallback. Enabling it again in `/plugins` starts a fresh instance.

`/plugins` lists TUI plugins under "TUI" and the server's under "Server", each active, inactive, skipped, failed,
pending or declined; `ctrl+a` shows the built-ins. Enter enables or disables a plugin, or asks about a pending one. A
failed plugin has an `x`, and Space ("view error") shows its error (Enter, on a target that did not load). A toast
"Plugin failed: <id>" offers "Open plugins", and the home footer counts failed plugins. The log (`opencode.log` in the
directory `opencode-native debug paths` prints) has every failure.

A crash of the process ends the client; only the Luau VM could cause one, and there is no crash guard. If a plugin
keeps the client from starting, `opencode-native --no-plugins` starts the TUI with no external plugin for that
run: no Luau, TypeScript or local plugin, and the built-ins as always. It is not in the TypeScript CLI
([`D01-no-plugins.md`](../parity/deviations/D01-no-plugins.md)). `OPENCODE_PLUGIN_LUAU=0` and `OPENCODE_PLUGIN_JS=0`
turn off one carrier for as long as they are set.
