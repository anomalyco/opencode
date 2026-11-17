# opencode-plugin-abi

The SDK of native TUI plugins for `opencode-native`. A plugin is a shared library that depends on this crate alone and
exports itself with `plugin!`, which holds every `unsafe` the C ABI needs. The host loads it at startup and again when it changes. The design, the
lifecycle and the callback rules are in [`docs/P.4.md`](../../docs/P.4.md). Every type is documented in the rustdoc
(`cargo doc -p opencode-plugin-abi --open`).

Plugins load on Linux (`.so`), macOS (`.dylib`) and Windows (`.dll`). The host opens libraries with `dlopen`, and
with `LoadLibraryW` on Windows.

## Quick start

This plugin adds a command (palette entry "Say hello", and `/hello`) that shows a toast, and a `hello` text at the end
of the home screen's footer that runs the same command when clicked. It is `crates/plugin/examples/hello`, which the
tests build and load, so what you see here works.

Make a library crate:

```sh
cargo new --lib opencode-hello-plugin
```

`Cargo.toml`:

```toml
[package]
name = "opencode-hello-plugin"
version = "0.1.0"
edition = "2024"
publish = false

[lib]
name = "opencode_hello"
crate-type = ["cdylib"]

[dependencies]
opencode-plugin-abi = { git = "https://github.com/anomalyco/opencode", rev = "<commit of your opencode-native build>" }
```

The crate is not on crates.io. Cargo finds it inside the repository by its name. The commit of a build is the
`commit=` of the `cli starting` line its start writes to the log (`opencode-native debug paths` prints the `log`
directory). A build of your own checkout logs `commit=unknown`: use the path to that checkout instead,
`opencode-plugin-abi = { path = "<checkout>/packages/cli-rs/crates/plugin-abi" }`. Edition 2024 needs Rust 1.85
or newer. Keep the default `panic = "unwind"`: the SDK catches a plugin's panics only when they unwind. It catches
them on the calls the host makes and on the threads `Setup::spawner` starts, whose panic fails the plugin and is
logged. A panic on a thread the plugin starts itself (`std::thread::spawn`) is silent: the SDK silences the plugin's
panic hook for the whole process, so that thread ends, the plugin stays active, and nothing is logged or shown. Start
threads with the `Spawner`.

`src/lib.rs`:

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

`"example.hello"` is the plugin's ID; `plugin!(setup)` takes the crate's package name instead. It names the plugin in `/plugins` and in `cli.json`, and it scopes the plugin's
storage keys. Build the library:

```sh
cargo build --release
```

The library is `target/release/libopencode_hello.so` (`.dylib` on macOS, `opencode_hello.dll` on Windows). Install it
in one of these ways:

- Copy it to `plugin.so` (`plugin.dylib` on macOS, `plugin.dll` on Windows) in a directory of its own under a
  `plugins` directory. The global one is `~/.config/opencode/plugins/` (`$OPENCODE_CONFIG_DIR/plugins/` when that is
  set). The project's is `.opencode/plugins/` in the project root, or in any directory between the root and the
  working directory. A plugin in a project's directory runs only once you approve it in `/plugins`, and you are asked
  again when its library changes. For the global one:

  ```sh
  mkdir -p ~/.config/opencode/plugins/hello
  cp target/release/libopencode_hello.so ~/.config/opencode/plugins/hello/plugin.so
  ```

- Or name the library, or a directory that holds `plugin.so`, in the `plugins` list of `~/.config/opencode/cli.json`.
  A path is absolute, starts with `./` or `../` (from `~/.config/opencode`), or is a `file://` URL; `~` is not
  expanded. The object form passes `options`, which setup reads as JSON text from `Setup::options()`:

  ```json
  {
    "plugins": [
      { "package": "/home/me/src/opencode-hello-plugin/target/release/libopencode_hello.so", "options": { "loud": true } }
    ]
  }
  ```

Start `opencode-native`. The home screen's footer ends in `hello`, and `/hello` or the palette's "Say hello" shows the
toast. While the TUI runs, a new build copied over the installed one replaces the running plugin.

While you work on it, `opencode-native plugin dev <crate dir>` does the build, the install and the reload for you: it
runs the TUI with the plugin and builds it again on each change. `opencode-native plugin test <crate dir or library>
[--route NAME] [--command NAME[=INPUT]] [--wait TEXT]...` prints the screen as text, with no server, for a test or a
quick look, and fails when the plugin fails, the route is not its own, or a command does not run.
A plugin in C uses `include/opencode_plugin.h` instead of this crate; `crates/plugin/examples/c/plugin.c` is one. On
Linux and macOS build it with `cc -shared -fPIC -I<checkout>/packages/cli-rs/crates/plugin-abi/include plugin.c -o
plugin.so` (`plugin.dylib` on macOS) and install the library as above.

Open `/plugins` to see the plugin's state. External plugins are listed under TUI, built-ins only after `ctrl+a`.
Enter disables or enables the selected plugin. A plugin that failed has an `x`, `failed` in its row, and a toast
"Plugin failed: example.hello" with "Open plugins". Space on its row ("view error") shows the error, such as a
setup's `Err`, a panic's message, or why the library was refused; on a library that never loaded, Enter shows it.
The log file in `~/.local/share/opencode/log/` has the same errors, and each request the plugin answered with an
error.

## Which binaries load

A plugin binary carries its ABI version. The host is ABI 2.0:

| Built with | Loads | What the host sends it |
| --- | --- | --- |
| The 2.0 SDK, this crate | yes | Renders (`RenderFence`, `Render`, `RenderRoute`), handlers (`Command`, `Event`, `Reply`, `Mount`, `RouteMount`, `Wake`, `FenceGone`, `Deltas`), surfaces (`View`, `Draw`, `Layout`, `Input`, `Unmount`), claims (`Claim`), messages (`Message`), searches (`Search`) and the plugin list (`Plugins`); `schema/v2.json` has each |
| A 1.x SDK, from this branch's development | no: "plugin ABI 1.x is not supported: … rebuild the plugin against opencode-plugin-abi 2" (decision O-169) | — |
| A 3.x SDK | no: "plugin ABI 3.0 is not supported: … rebuild the plugin against opencode-plugin-abi 2" | — |

`Host::try_fetch` and `Host::try_foreground` return `Result<RequestId, String>`: an `Err` is a request the host did
not take, as while the effects that wait fill its queue, and no reply comes for it; an ID always gets its one reply.

A request belongs to what asked for it, on every carrier. One a mount's call asks for (a command of the route it
shows, or a handler of the mount's input) is that mount's: once the mount closes, it is not sent, a program does not
start, and its reply is dropped, also when the surface opens again under the same key. One from setup, a global
command, an event, a wake, or the mount's begin and end (`Event::Mount`, which the plugin hears, not the mount) is the
activation's, and its reply comes unless the plugin is disposed first.

### The source promise of 2.x

A plugin's source that builds on the 2.0 SDK builds on every later 2.x SDK (carbon-4, big-boi 14). So every type of
the contract that a later 2.x may extend is `#[non_exhaustive]` from 2.0 on, to the plugin's crate:

- A struct literal of one does not compile, also with `..Default::default()`. Build it from its constructor or
  `Default`, and set what it needs with its setters, one a field and named for it: a value takes what converts into
  the field (`.title("Say hello")`), an optional field takes the value itself (`.slash("hello")`, no `Some`), a flag
  takes nothing (`.palette()`), and a list takes anything that iterates (`.keys([..])`). For a value that is already
  an `Option` or a `bool`, `.maybe(focus, Select::focus)` and `.when(centered, Panel::centered)`:
  `Command::new("hello.greet").palette()`, `Toast::new(..).title(..)`, `Confirm::new(..).labels("Clear", "Cancel")`,
  `Prompt::new(title, action).placeholder(..)`, `Fetch::new("GET", path).query([("limit", "20")])`,
  `Layout::default().absolute(Absolute::new().top(0).right(1).z(10))`,
  `Attention::new(..).sound(..)`, `PanelAction::new(title, action).key(..)`, `OpenPanel::new("notes")`,
  `Overlay::new(..)`, `Foreground::new("sh").args(..)`, `Interact::default().focusable()`,
  `Layout::default().width(..).grow()`, `LayoutReply::default().paint(..).again()`.
- A node of `v2::Node` is built with its constructors (`Node::column`, `row`, `text`, `scroll`, `list`, `input`,
  `diff`, `code`, `image`, `markdown`, `spinner`, `canvas`, `slot`, `keep`, `fence`) and its setters (`with_id`, `bg`,
  `border`, `placeholder`, `numbers`, …); a pattern of a variant needs `..`: `Node::Keep { key, .. }`.
- A `match` on an enum of the contract (`interact::Event`, `claim::Part`, `v2::Cause`, `SessionStatus`, …) needs a
  `_` arm, which a kind a later 2.x adds reaches; a pattern of an event's fields needs `..`:
  `Event::Paste { text, .. }`.
- What the host fills (`SurfaceInput`, `Geometry`, `Session`, …) is read as before.
- Struct variants a plugin builds (a scroll verb, a target, a composer edit, an anchor) do not grow: a later 2.x adds
  a variant for a new form. `Rgba`, `Edges`, `Sides`, the rects and `ThemeMode` are whole and stay open.
- The table `plugin!` exports is built by the SDK (`runtime::table`), so a table entry a later 2.x appends is no break
  either.

The wire is the other half of the promise: a later 2.x adds only optional fields, request types the host sends only
to a library of that minor, and node kinds an author lowers for an older host with `v2::View::or` (below). The
host's own build turns on the crate's `host` feature, which leaves its types exhaustive so the host must handle each
addition. That feature is for the host only and is not covered by this promise: a crate that turns it on may break
on any later 2.x, so a plugin never turns it on. `tests/sdk.rs` builds a pinned author crate, `tests/pinned`, against this SDK and
against the additions a later 2.x makes (the `next` feature), so a change that breaks that source fails the SDK's own
tests.

### What 2.0 added after its first release candidate

These are optional on the wire, with no new minor (O-168): a plugin that uses one meets a host without it by the rules
below.

- **Named features.** `Read::abi().features` lists the host's optional features, and `Abi::has_feature` asks for one:
  `image-bounds` (`IMAGE_BOUNDS`), `focus-input` (`FOCUS_INPUT`) and `fence-node` (`FENCE_NODE`). A plugin that cannot
  work without one names it, `plugin!(id = "my.plugin", requires = ["focus-input"], setup)`, and a host without it
  refuses the plugin at load; one that can checks the feature and falls back.
- **The focus of a field** (`focus-input`). `Host::focus` gives the focus to a `Node::Input` with an id as a click
  does, so what the user types goes into the field; a `LayerScope::Node` of the field holds while it has the focus,
  and `Read::focused` names it. The rules of any focus stand: none while a host dialog is open, none in a hidden box,
  none during setup or from a view. A call the user did not cause may ask for it, as for a focusable box. A host
  without the feature refuses the focus, and the field takes it only from the user's click.
- **The host's code view of a claimed fence** (`fence-node`). `Node::fence()`, with `bg`, in a fence claim's tree:
  the fence as the host's own code view draws it, in the transcript's theme, concealment and streaming state, current
  with each revision with no view. It is one node and one row, whatever its code, so a long fence draws whole. Only a
  fence claim's tree may hold it, once: a surface's view that holds it fails the plugin, and a claim's tree that holds
  it twice shows the host's row. For a host without the feature, lower it: `view.or(Node::fence(), |view| ...)`, as
  `View::or` lowers a kind of a later minor; the SDK refuses a tree that still holds it before it crosses.
- **Where a dialog sits.** `Select::centered`, and `size` and `centered` on `Alert` and `Confirm`: in
  the middle of the screen, not a quarter of the way down, and medium, large or extra large (TS `dialog.set({ size,
  centered })`). A host that does not know them places the dialog as before. A keyed select shown again with another
  `centered` moves and keeps its filter and its selected row.
