# Plugins in `opencode-native`

How plugins work in the native client, in one place: the contract and the four ways a plugin runs against it, how a
handler waits for an answer, what bounds a plugin, and the shortest plugin in each language. It is written for an
engineer who has not followed the work. Paths are relative to `packages/cli-rs`.

The references behind it:

- [`P.4.md`](P.4.md): the C ABI, every callback's rules, discovery, approval, the JS host, lifecycle, conformance.
- [`P.1.md`](P.1.md): slots and the registry.
- [`../crates/plugin-abi/README.md`](../crates/plugin-abi/README.md): building and installing a native plugin.
- `cargo doc -p opencode-plugin-abi --open`: every type.

## 1. The model

### One contract, four carriers

A plugin never holds a widget, the TUI or the store. It registers what it adds in a `setup` function, reads through a
read handle, asks for effects through a host handle, and returns trees of nodes that the host draws. That interface is
the **contract**: the crate `crates/plugin-abi` (`opencode-plugin-abi`, ABI 2.0). Its messages have one schema,
`crates/plugin-abi/schema/v2.json`, generated from the crate's types.

A **carrier** is a way to run a plugin against the contract. There are four:

| Carrier | A plugin is | How a call crosses | Host code |
| --- | --- | --- | --- |
| Linked Rust | an `abi::Plugin { id, setup }` compiled into the client. Every built-in is one (`crates/tui/src/plugins`, `crates/latex`, `crates/mermaid`) | Rust values, in process | `Builtin` in `crates/plugin/src/lib.rs` |
| C ABI | a shared library that exports `opencode_plugin_v2`: a Rust `cdylib` that calls `plugin!`, or C on `crates/plugin-abi/include/opencode_plugin.h` | JSON in byte buffers, in process | `crates/plugin/src/loader/native.rs` |
| Luau | a directory with `plugin.toml` and `init.luau` | Luau tables decoded straight into the contract's types, in process, in a sandboxed VM for each activation | `crates/plugin/src/luau` |
| Pipe | a TypeScript TUI plugin as the TypeScript client loads it: a `{ id, setup }` module with JSX | the same messages, framed, to one Bun process that runs every TS plugin (the JS host) | `crates/plugin/src/pipe` |

- **The built-ins use the API that external authors use.** There is no private plugin surface (`P.1.md`, "Shape").
- **The first three run on the UI thread, inside the frame.** The pipe is a second tier: no frame waits for the JS
  host, so a TS plugin's tree and its reads arrive a frame or more late (`P.4.md`, "TypeScript plugins on the JS
  host").
- **A TS plugin runs unmodified.** The compatibility layer (`crates/plugin/src/pipe/compat`, bundled into
  `compat.js`) gives its `setup` the context the TypeScript client gives it, and turns its JSX into contract trees,
  its reads into snapshots and its calls into effects. What does not map is listed in
  `parity/deviations/F16-v2-compat-layer.md`.
- **Tests hold the carriers to the same behavior.** `crates/tui/tests/all/plugin_carriers.rs` runs one plugin source
  linked, through the C ABI's byte shims, and as a loaded library. `plugin_ownership.rs` runs one table of request
  ownership in process, through the C ABI, over the pipe and in Luau. `plugin_published.rs` and the P.8 scenarios of
  P-APP run published TS plugins on the JS host and compare their cells and requests with TS's.

Which carriers a build has:

- The JS host is the cargo feature `ts`, on by default. `OPENCODE_PLUGIN_JS=0` turns it off at run time.
- Luau is the cargo feature `luau` and the run-time switch `OPENCODE_PLUGIN_LUAU`. A Luau plugin loads only in a build
  with the feature and with the switch on. The feature's default is in `crates/cli/Cargo.toml`, and what the switch
  takes in `enabled` of `crates/plugin/src/luau/mod.rs`.

Plugins are found in the `plugins` directories (`~/.config/opencode/plugins`, and `.opencode/plugins` of the project)
and in the `plugins` list of `cli.json`. A project's plugin runs only after the user approves it in `/plugins`
(`P.4.md`, "Discovery and configuration" and "Approval of a project's plugins").

### What a plugin registers

`setup` runs once for each activation. The same things have these names on each carrier:

| What | Rust (`Setup`, `Host`) | Luau (`setup`, `host`) | TypeScript (`context`) |
| --- | --- | --- | --- |
| A command: palette entry, `/slash`, keybind | `setup.command(Command::new(..), run)` | `setup:command({ name = .. }, run)` | `keymap.layer(() => ({ commands }))` |
| Keys in a scope or a mode | `setup.layer(Layer, handler)`, `Surface::layers` | `setup:layer(layer, handler)` | a layer's `mode`, `target` and each command's `bind` |
| A slot claim | `setup.slot(Placement, render)` | `setup:slot({ path, kind }, render)` | `ui.slot({ append: path, render })` |
| A route, a page of its own | `setup.route(name, render)` | `setup:route(name, render)` | `ui.router.register(page)` |
| A surface: a route, a slot, a docked panel or an overlay with a keyed tree and its own input | `setup.surface(v2::Surface)` | `setup:surface(spec, view, handler)` | each slot, route and panel is one, through the compat layer |
| A dialog: prompt, select, confirm, alert, panel | `host.dialog(Dialog::..)` | `host:dialog({ type = .. })` | `ui.dialog.prompt`, `select`, `confirm`, `alert`, `show` |
| Storage, by declared key | `setup.storage_key`, `read.storage_get`, `host.storage_set` | `setup:storageKey`, `read:storageGet`, `host:storageSet` | `storage.store(key, ..)` |
| Server events | `setup.on_event(types, run)`, `setup.on_deltas` | `setup:onEvent(types, run)` | `data.on(type, ..)` |
| A renderer of a code fence or a tool call | `setup.code_block`, `setup.claim` | `setup:codeBlock` | `markdown.registerCodeBlockRenderer` |
| Mount and disposal hooks | `on_mount`, `on_route_mount`, `on_dispose` | `onMount`, `onRouteMount`, `onDispose` | the cleanup `setup` returns |

Every call into a plugin gets one of two handles:

- **A read handle** (`Read`): sessions, messages, models, the route, the theme's colors, the composer, tabs, storage.
  Reads are pure, and all reads of one call see one snapshot of the store. A render or a view gets only this.
- **A host handle** (`Host`): the reads, and effects such as a toast, a dialog, a navigation, a fetch, a storage write
  or a focus. Effects wait until the outermost call into the plugin returns, then run in the order they were asked
  for, so a plugin never re-enters itself through the host. A call that panics leaves no effect.

On the pipe a read cannot be synchronous. The host pushes a snapshot of each read a plugin watches, at most 128 a
plugin (`crates/plugin/src/pipe/guest.rs`, `WATCHES`), before each event and at each change.

### How a render works

A render is a function the host calls. It reads, and returns data. It never draws.

- **A slot or route render** (`Setup::slot`, `Setup::route`) returns a `Render`
  (`crates/plugin-abi/src/lib.rs`):
  - `Keep`: what the claim shows stays;
  - `Hide`: the claim takes no room;
  - `Show(node)`: the claim shows `node`, a box, text, nested slot, Markdown or spinner. A node of the same kind in
    the same place as before keeps its widget.
- **A surface's view** (`Setup::surface`) returns a tree of `v2::Node` (`crates/plugin-abi/src/v2.rs`): box, text,
  slot, Markdown, spinner, scroll, diff, input, list, code, image, canvas, fence and keep. A node may carry an `id`.
  - `Node::Keep { key }` stands for the subtree last adopted under that id, unchanged. `View::memo(key, value, build)`
    returns it when `value` is the one the subtree was built from, so the plugin does not build it and the host does
    not compare it.
  - A box with `visible: false` takes no room.
- **The host reconciles a surface's tree by id** (`crates/plugin/src/reconcile.rs`). A node whose id and kind stay
  keeps its widget and the widget's state: a scroll offset, the focus, half-typed text. The host writes only what
  differs.
- **A surface's tree is adopted whole or refused whole.** After a refusal the last tree stays. A keep of an id the
  host does not hold makes the host ask at once for a whole tree, and a second refusal in a row fails the plugin. Any
  other malformed tree, such as one with an id twice or with more than 64 layout levels, fails the plugin at once
  (`crates/plugin/src/surface.rs`).
- **A render runs again when something it could show changed.** It is told what in `Changed`: a batch of the store
  (sessions, message lists, messages, catalogs), the host's own state (`local`), its size, or `woken` after one of the
  plugin's own handlers ran. A render that finds nothing it shows changed returns `Keep`.
- **A mount** is one showing of one surface. It owns its widgets, its memo table, its key layers and its requests,
  and all of them end with it.

`P.4.md` has the rules in full: "When claims render", "Contract 2.0 surfaces", "Contract 2.0 input and surfaces".

## 2. Waiting: tasks, `await` and timers

### Why

Ten published TS plugins were ported to Rust and to Luau (now in the external `plugins` repository, one directory
per plugin with `rust` and `luau`; the originals are pinned in `parity/plugins/npm`). **The cost was in waiting,
not in drawing.** A plugin that mostly draws came out shorter than its TS source. A plugin that waits for dialogs and
replies came out much longer, and all of the excess was plumbing: an enum of what the open dialog asks, a map of the
requests in flight, and a generation stamp on each dialog so that an old dialog's close is not read as the new one's.

Lines that are neither blank nor comments, Rust without its unit tests:

| Port | What it does | TS | Rust, before → now | Luau, before → now |
| --- | --- | ---: | --- | --- |
| queue-manager | a menu of chained dialogs, ordered writes | 380 | 655 → 435 | 584 → 461 |
| session-usage | paged fetches in batches, a 15 s tick | 527 | 856 → 645 | 453 → 419 |
| session-manager | a page with search, rename and confirms | 1,083 | 1,366 → 1,269 | 1,056 → 999 |
| command-hotkeys | keys that write to the server | 173 | 251 → 223 | 209 → 211 |
| sidebar-tokens | draws only | 122 | 56 | 50 |

"Before" is commit `77bce1bf4c`, where a port answered each dialog and each reply in a handler of its own. "Now" has
tasks, typed API calls, timers and shorter builders. The task rewrite alone took queue-manager from 633 to 426 lines
in Rust (`cb3057de8b`) and from 584 to 466 in Luau (`16b89348b1`). The TS column counts the TUI sources of each
package; command-hotkeys and sidebar-tokens ship compiled output.

### A task

A handler that must wait runs as a **task**.

- **A task has no thread.** It runs only inside a call the host makes to the plugin, on the UI thread, on the host's
  clock.
- **When it waits, it returns to the host.** The answer comes as another call into the plugin: a reply, the dialog's
  answer or close, a timer's reply, or a wake. That call goes on with the task from where it waited.
- **A waiting task costs no time.** Each stretch between two waits is part of one host call, so it is timed, bounded
  and blamed as any call is (section 3). What the task asks for in a stretch takes effect when that call returns.
- **Two tasks interleave at their waits,** as two `async` calls do in TS.

**Rust: a future the SDK polls** (`crates/plugin-abi/src/task.rs`). `Setup::tasks()` returns a `Tasks` handle, and a
handler starts a task with `tasks.spawn(host, f)`. The task is a plain `Future` with real wakers, so other crates'
combinators work on it; `task::join_all` waits for several. Its `Cx` has the waits (`select`, `prompt`, `confirm`,
`alert`, `fetch`, `foreground`, `sleep`, `blocking`, and the typed `call` and `send` of `src/call.rs`). `Cx::with`
lends a closure the host of the call that polls the task; the borrow cannot be held across a wait. A plugin that
never calls `Setup::tasks` registers nothing for it. This is the module's own example, which its doc tests compile:

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

**Luau: a coroutine the prelude drives** (`crates/plugin/src/luau/plugin.luau`). Every handler the host calls with a
`host` is already a task: a command's, an event's, a mount's, a layer's and a surface's. A waiting call parks the
coroutine and returns the answer. A request returns `value, nil` or `nil, err`; a dialog returns its answer, or `nil`
when it closed without one. `plugin.spawn(f)` starts another task, and `plugin.all({ f, .. })` waits for several. A
render, a view and `setup` itself are not tasks, and a waiting call there fails with a message. The same handler as
above, which `luau::tests::the_guides_luau_wait_runs_as_written` runs from this file:

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

**TypeScript: promises, as in the TS client.** `await context.ui.dialog.confirm(..)` and `await context.client..`
work as they do there (`crates/plugin/examples/pipe/v2probe/tui.tsx`, the command `v2probe.ask`). On the pipe each is
an effect whose answer comes back in a later message.

**C** has no `async` to map to. A C plugin answers the `reply` and `cancelled` requests the host sends it
(`crates/plugin-abi/include/opencode_plugin.h`) and keeps its own state.

Both SDKs also send typed API calls, generated from the server's OpenAPI document, so a path or a field that does not
exist fails the build or the type check: `cx.call(client::session_inbox_list(&input)).await?` in Rust, and
`plugin.client.session.inbox.list({ sessionID = id })` in Luau, which returns `items, nil` or `nil, err`.

### What goes on with a waiting task, and what ends it

| When | What happens |
| --- | --- |
| Its dialog is answered | It goes on with the answer |
| Its dialog closes any other way: escape, the backdrop, another dialog in its place | It goes on with `None` in Rust and `nil` in Luau. A confirm answers `false` on escape |
| Its reply comes | It goes on with the body, or with the error |
| The mount that owns its request closes first | The host cancels the request. The task goes on once, with the error `cancelled` (`task::CANCELLED`), and no reply comes after |
| The plugin is disabled, fails, is replaced by a new build, or the client exits | The task is dropped and never goes on. In Rust its destructors run |

### Ownership and cancel

**A request belongs to what asked for it**: a mount, or the plugin's activation. A fetch, a program in the foreground
and a timer are requests.

- A request that a mount's call asks for is the mount's. A mount's calls are a command of the route it shows and a
  handler of the mount's input. Once the mount closes, a request that has not gone out is not sent, a program does
  not start, and a reply is dropped, also when the surface opens again under the same key.
- Every other request is the activation's: one from `setup`, a global command, an event, a wake, or a mount's begin
  and end notification. Its reply comes unless the plugin is disposed first.
- **A task keeps the owner of the call that started it** (`Host::owner`). What it asks for, before a wait and after
  it, is still that mount's, or still the activation's, whichever call goes on with it. The Rust SDK sets the task's
  owner for each stretch it runs (`Host::set_owner`), and the Luau prelude does the same.
  - A task that a mount's handler started ends with the mount: a request in flight is cancelled, and so is one it
    asks for after the close.
  - A task of the activation's stays the activation's, also when a mount's call wakes it.
  - A task started from another task (`Cx::spawn`, `plugin.spawn`) has its starter's owner.
- **Cancel is told once.** A task hears it as the error above. A Rust plugin without tasks hears it in
  `Setup::on_cancelled`. On the pipe, the TS promise rejects with an `AbortError`.

The rule for requests is in `Host::try_fetch`'s documentation and in `P.4.md` ("Fetch"). The rows that hold it are in
`crates/tui/tests/all`:

- the table of `plugin_ownership.rs`, on all four carriers;
- `a_task_parked_on_its_mounts_fetch_goes_on_once_cancelled` there, and
  `an_every_a_mount_started_ends_with_that_mount` in `plugin_timers.rs`, each in process, through the C ABI and in
  Luau;
- `a_task_a_mount_wakes_keeps_the_activations_owner` in `plugin_ownership.rs`, in process and through the C ABI.

### Timers

A plugin keeps time on the host's clock, with no thread of its own. A timer is a request (`Host::try_timer`,
`{"type": "timer", "ms": N}` on the wire), so it is owned and cancelled as a fetch is.

| | Rust | Luau |
| --- | --- | --- |
| Wait once | `cx.sleep(duration).await` gives `Ok(())` or the error | `plugin.sleep(ms)` returns `true`, or `nil, err` |
| Tick | `tasks.every(host, period, \|cx\| async { .. })`, until the future gives `ControlFlow::Break` | `plugin.every(ms, function(host) .. end)`, until the function returns `false` |

- **At least 20 ms** (`MIN_TIMER`). A shorter delay is lengthened to it.
- **A Luau delay keeps its part of a millisecond,** so `plugin.sleep(20.9)` waits 20.9 ms. `plugin.sleep(math.huge)`
  never wakes. A delay that is not above 0, or not a number, is the 20 ms minimum
  (`luau::tests::plugin_sleep_keeps_a_part_of_a_millisecond_and_waits_for_ever_on_math_huge`).
- **At most 32 timers of a plugin wait at once** (`MAX_TIMERS`). One more is refused through its reply, so the sleep
  returns the error.
- **A sleep dropped before its time lets its timer go** (`Host::cancel_timer`). In Rust that is the loser of a race:
  it holds none of the 32 places and wakes nothing (`plugin_timers::dropped_sleeps_hold_no_timer`).
- **A late tick is one tick,** not one for each period it missed: `every` is a sleep in a loop.
- **A tick that changes nothing on screen draws no frame**
  (`plugin_timers::a_ticking_plugin_that_changes_nothing_makes_no_frame`).
- **Each tick is judged on its own.** A timer's call that asks for no paint ends its frame 17 ms later (`IDLE_CLOSE`
  in `crates/plugin/src/lib.rs`), which is under the shortest timer. So each tick of a 20 ms timer is measured alone
  against the frame budget of section 3, and cheap ticks do not add up to a slow plugin
  (`plugin_timers::a_fast_timer_with_cheap_ticks_is_not_slow`).
- **An `every` that a mount started is that mount's task.** Its sleeps and what its ticks ask for are the mount's,
  also after a tick that waited for a reply, and the loop ends when the mount closes.
- A TS plugin uses the JS host's own `setTimeout` and `setInterval`. The pipe refuses the timer request.

## 3. Limits and safety

A plugin is code the user chose to run. Nothing here is a security boundary for a native library, which runs in the
client's process. The limits keep one plugin from freezing or starving the client, and say who is to blame.

| What is bounded | Linked, C ABI | Luau | Pipe (TS) |
| --- | --- | --- | --- |
| Time in one frame | 1 ms a plugin, 4 ms for all. Over it in more than 12 of its last 120 frames, the plugin is slow, which the user is told once a session | the same | no frame waits for the JS host |
| One call | over 100 ms of CPU time, an external plugin fails when the call returns; a built-in's is logged as a host bug | the VM's interrupt stops the call at 100 ms of CPU time, and the plugin fails | a JS host that owes an answer and sends nothing for 1 s (10 s for a load or a setup) is ended and started again; the plugin it was running fails |
| A call that never returns | a notice at 0.5 s; at 2 s the client is ended, and its parent starts it again with an external plugin held off | the interrupt stops a call that spins before that | as above |
| Memory | the client's | 32 MiB of heap for each VM; 1 MiB of sources | 512 MiB resident for the JS host |
| What crosses in one message | 256 MiB a buffer (C ABI) | a value the plugin hands over: 320,000 keys and values, 32 MiB of strings, 128 levels of nesting | 256 KiB a control message, 8 MiB a tree; 512 unread messages and 8 unread trees |
| Waiting work | 256 tasks, 32 timers, 4 `blocking` threads, 64 dialogs awaiting an answer | 256 parked tasks, 32 timers, 64 dialogs | 256 effects a call, 128 watched reads |

On every carrier:

- **What a tree may make the host build** is bounded before anything is built: 20,000 nodes and 3,000 rows a tree, 1
  MiB of text a node, 32 MiB of content a plugin (`crates/plugin/src/limits.rs`). The node that crosses a limit shows
  a placeholder, and the rest of the tree draws.
- **Storage:** 128 keys a plugin, 256 KiB a value (`crates/plugin/src/storage.rs`).
- **Effects:** 1,024 run in one frame, for all plugins (`FRAME_EFFECTS` in `crates/plugin/src/lib.rs`).
- **A panic, a Luau error or a thrown exception fails that plugin alone.** None of the failed call's effects apply.
  Its surfaces show the host's fallback, and `/plugins` shows the error.

Where the numbers are:

- Time: `crates/plugin/src/contain/mod.rs` (`Limits`). `OPENCODE_PLUGIN_LIMITS` changes them, as in
  `frame=2ms,overrun=250ms`.
- Luau: `crates/plugin/src/luau/vm.rs` (`MEMORY`, `Budget`), `luau/mod.rs` (`SOURCES`), `luau/decode.rs` (`Decode`).
  The sandbox has no file system and no `loadstring`, and `require` reaches only the plugin's own files.
- Pipe: `crates/plugin/src/pipe/child.rs` (`Limits`), `pipe/wire.rs` (`CONTROL_CAP`, `TREE_CAP`), `pipe/guest.rs`
  (`EFFECTS`, `WATCHES`).
- Tasks and timers: `crates/plugin-abi/src/task.rs` (`MAX_TASKS`, `ANSWERS`, `MAX_THREADS`), `src/lib.rs`
  (`MIN_TIMER`, `MAX_TIMERS`), `crates/plugin/src/luau/plugin.luau` (`PARKED`, `SLOTS`).
- A segfault or a hang in a native library: the client runs under a small parent process that restarts it with that
  plugin held off (`crates/cli/src/contain.rs`; `P.4.md`, "Failures").

## 4. Writing a plugin

The same plugin three times: a command, in the palette and as `/hello`, that shows a toast, and a `hello` at the end
of the home screen's footer that runs the command when clicked. Each file below is in the repository, and a test
loads it and runs it.

### Rust

`crates/plugin/examples/hello/src/lib.rs`:

```rust
use opencode_plugin_abi::{Click, Command, Node, Placement, Render, Setup, Span, Toast, Variant, plugin};

fn setup(setup: &mut Setup) -> Result<(), String> {
    // A command in the palette and as `/hello`.
    setup.command(Command::new("hello.greet").title("Say hello").slash("hello").palette(), |host, _input| {
        host.toast(Toast::new(Variant::Success, "Hello from a plugin"))
    });
    // A line at the end of the home screen's footer; a click runs the command.
    setup.slot(Placement::append("home.footer"), |_read, _input, _changed| {
        let text = Node::text([Span::new("hello").fg("text.muted")]);
        Render::Show(text.on_click(Click::command("hello.greet")))
    });
    Ok(())
}

plugin!(id = "example.hello", setup);
```

It is a `cdylib` crate that depends on `opencode-plugin-abi` alone. The SDK's
[README](../crates/plugin-abi/README.md) has the manifest, the build and the install.

- Install: copy the library to `~/.config/opencode/plugins/hello/plugin.so` (`plugin.dylib`, `plugin.dll`).
- While you work: `opencode-native plugin dev <crate dir>` builds it, runs the TUI with it, and reloads it on each
  change. `opencode-native plugin test <crate dir> --command hello.greet` prints its screen with no server.
- Test: `loader::native::tests::the_quick_start_plugin_loads_from_a_plugins_directory_and_runs` in
  `crates/plugin`.

### Luau

`crates/plugin/examples/luau/hello/init.luau`:

```lua
--!strict
-- `examples/hello` in Luau, line for line.
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
# The quick start (`examples/hello`) in Luau: a command and a footer line that runs it.
id = "example.luau-hello"
name = "Hello"
version = "0.1.0"
contract = "2.0"
description = "A command in the palette, and a line in the home footer that runs it"
```

- Install: copy the directory to `~/.config/opencode/plugins/hello/`. There is no build, and the same files run on
  every platform.
- Types: `crates/plugin/src/luau/opencode/plugin.luau` is a typed stub of `@opencode/plugin`, generated from the
  schema. A `.luaurc` that aliases `opencode` to its directory lets `luau-analyze` and luau-lsp check a plugin
  (`crates/plugin/examples/luau/.luaurc`). `bun run check:luau-types` checks every Luau plugin in the repository.
- Test: `luau::tests::the_luau_quick_start_loads_from_a_plugins_directory_and_runs` in `crates/plugin`, and
  `plugin_luau::the_luau_quick_start_draws_and_sends_what_its_rust_source_does` in `crates/tui`.

### TypeScript

`crates/plugin/examples/pipe/hello/tui.tsx`:

```tsx
/** @jsxImportSource @opentui/solid */
// `examples/hello` as a TypeScript TUI plugin, which the JS host runs.
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

- Install: copy the file to `~/.config/opencode/plugins/hello/tui.tsx`, or publish it as an npm package and run
  `opencode-native plugin add <name>`.
- It needs Bun, which the client finds in the `opencode` binary or on the `PATH` (`P.4.md`, "TypeScript plugins on
  the JS host").
- Test: `plugin_compat::the_guides_typescript_hello_runs_on_the_js_host` in `crates/tui`.

### Larger examples

| Example | Shows | Where |
| --- | --- | --- |
| queue-manager | chained dialogs and ordered writes as one task | `plugins` repository, `queue-manager/{rust,luau}` |
| session-usage | paged typed calls in batches, work off the UI thread, a tick | `plugins` repository, `session-usage/{rust,luau}` |
| session-manager | a route with two key layers, a search field, a debounce | `plugins` repository, `session-manager/{rust,luau}` |
| goal-plugin | a sidebar read from tool results, a 1 s tick that runs only while the sidebar shows | `plugins` repository, `goal-plugin/{rust,luau}` |
| board | surfaces: a route of memoized cards, a panel, an overlay, a thread's mailbox | `crates/plugin/examples/board` |
| c | a plugin in C on the header alone | `crates/plugin/examples/c/plugin.c` |

The `plugins` repository holds the Rust and Luau ports of ten published TS plugins, each building on the SDK by git;
its README says how to build and install each. `/plugins` in the TUI lists every plugin with its state, and shows the
error of one that failed.
