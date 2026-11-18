# opencode-plugin-abi

The SDK of native TUI plugins for `opencode-native`. A plugin is a shared library that depends on this crate alone and
exports itself with `plugin!`, which holds every `unsafe` the C ABI needs. The host loads it at startup and again when
it changes.

- [`docs/plugins.md`](../../docs/plugins.md) explains how plugins work, on this carrier and the others (Luau, and
  TypeScript on the JS host): the model, tasks and timers, the limits, and how plugins are found and approved.
- [`docs/plugin-abi.md`](../../docs/plugin-abi.md) is the reference: the C ABI, what each callback may do, and the
  lifecycle.
- The rustdoc documents every type: `cargo doc -p opencode-plugin-abi --open`.

Plugins load on Linux (`.so`), macOS (`.dylib`) and Windows (`.dll`).

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

`"example.hello"` is the plugin's ID; `plugin!(setup)` takes the crate's package name instead. It names the plugin in
`/plugins` and in `cli.json`, and it scopes the plugin's storage keys. Build the library:

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

## Seeing what a plugin does

Open `/plugins` to see the plugin's state. External plugins are listed under TUI, built-ins only after `ctrl+a`.
Enter disables or enables the selected plugin. A plugin that failed has an `x`, `failed` in its row, and a toast
"Plugin failed: example.hello" with "Open plugins". Space on its row ("view error") shows the error, such as a
setup's `Err`, a panic's message, or why the library was refused; on a library that never loaded, Enter shows it.
The log file in `~/.local/share/opencode/log/` has the same errors, and each request the plugin answered with an
error.

## Requests and waiting

`Host::try_fetch` and `Host::try_foreground` return `Result<RequestId, String>`. An `Err` is a request the host did
not take, as while the effects that wait fill its queue, and no reply comes for it. An ID always gets its one reply.

A handler that waits for a dialog's answer or a reply can do it in a straight line: `Setup::tasks` starts tasks,
`async` code whose `Cx` awaits `confirm`, `prompt`, `select`, `alert`, `fetch`, `foreground`, `sleep` and `blocking`
(module `task`). [`docs/plugins.md`](../../docs/plugins.md#waiting-tasks-await-and-timers) explains tasks, who owns a
request, what a mount's close cancels, and timers.

## Compatibility

### Which binaries load

A plugin binary carries its ABI version. The host is ABI 2.0, and loads plugins of ABI 2.x:

| Built with | Loads |
| --- | --- |
| A 2.x SDK, this crate | yes |
| An SDK of another major | no: "plugin ABI 3.0 is not supported: … rebuild the plugin against opencode-plugin-abi 2" |

A plugin built with a later 2.x SDK loads on an older 2.x host and uses what that host offers. One that cannot work
without a newer host says so, `plugin!(id = "my.plugin", requires_minor = 1, setup)`, and an older host refuses it at
load and says to update `opencode-native`. `schema/v2.json` has every request the host sends a plugin.

### Optional features

A host states its optional features by name. `Read::abi().features` lists them, and `Abi::has_feature` asks for one.
A plugin that cannot work without one names it, `plugin!(id = "my.plugin", requires = ["focus-input"], setup)`, and a
host without it refuses the plugin at load. A plugin that can work without it checks the feature and falls back.

| Feature | Constant | What it adds |
| --- | --- | --- |
| `image-bounds` | `IMAGE_BOUNDS` | The host states the bounds of the images it decodes |
| `focus-input` | `FOCUS_INPUT` | `Host::focus` gives the focus to a `Node::Input` or a `Node::Scroll` with an id, as a click does, so what the user types goes into the field, and the arrows and the page keys scroll the scroll. A host without the feature refuses the focus, and the field takes it only from the user's click |
| `fence-node` | `FENCE_NODE` | `Node::fence()` in a fence claim's tree: the fence as the host's own code view draws it. For a host without the feature, lower it: `view.or(Node::fence(), \|view\| ...)`. The SDK refuses a tree that still holds it before it crosses |

Where a dialog sits needs no feature: `Select::centered`, and `size` and `centered` on `Alert` and `Confirm`. A host
that does not know them places the dialog as it would without them.

[`docs/plugin-abi.md`](../../docs/plugin-abi.md) has the rules of each.

### Source compatibility within 2.x

A plugin's source that builds on the 2.0 SDK builds on every later 2.x SDK. So every type of the contract that a
later 2.x may extend is `#[non_exhaustive]` to the plugin's crate:

- A struct literal of one does not compile, also with `..Default::default()`. Build it from its constructor or
  `Default`, and set what it needs with its setters, one a field and named for it. A value takes what converts into
  the field (`.title("Say hello")`), an optional field takes the value itself (`.slash("hello")`, no `Some`), a flag
  takes nothing (`.palette()`), and a list takes anything that iterates (`.keys([..])`). For a value that is already
  an `Option` or a `bool`, use `.maybe(focus, Select::focus)` and `.when(centered, Panel::centered)`. Examples:
  `Command::new("hello.greet").palette()`, `Toast::new(..).title(..)`, `Confirm::new(..).labels("Clear", "Cancel")`,
  `Prompt::new(title, action).placeholder(..)`, `Fetch::new("GET", path).query([("limit", "20")])`,
  `Layout::default().absolute(Absolute::new().top(0).right(1).z(10))`, `Attention::new(..).sound(..)`,
  `PanelAction::new(title, action).key(..)`, `OpenPanel::new("notes")`, `Overlay::new(..)`,
  `Foreground::new("sh").args(..)`, `Interact::default().focusable()`, `Layout::default().width(..).grow()`,
  `LayoutReply::default().paint(..).again()`.
- A node of `v2::Node` is built with its constructors (`Node::column`, `row`, `text`, `scroll`, `list`, `input`,
  `diff`, `code`, `image`, `markdown`, `spinner`, `canvas`, `slot`, `keep`, `fence`) and its setters (`with_id`, `bg`,
  `border`, `placeholder`, `numbers`, …). A pattern of a variant needs `..`: `Node::Keep { key, .. }`.
- A `match` on an enum of the contract (`interact::Event`, `claim::Part`, `v2::Cause`, `SessionStatus`, …) needs a
  `_` arm, which a kind a later 2.x adds reaches. A pattern of an event's fields needs `..`:
  `Event::Paste { text, .. }`.
- What the host fills (`SurfaceInput`, `Geometry`, `Session`, …) is read as any struct is.
- Struct variants a plugin builds (a scroll verb, a target, a composer edit, an anchor) do not grow: a later 2.x adds
  a variant for a new form. `Rgba`, `Edges`, `Sides`, the rects and `ThemeMode` are whole and stay open.
- The table `plugin!` exports is built by the SDK (`runtime::table`), so a table entry a later 2.x appends is no break
  either.

The wire is the other half of the rule: a later 2.x adds only optional fields, request types the host sends only to
a library of that minor, and node kinds an author lowers for an older host with `v2::View::or`.

The host's own build turns on the crate's `host` feature, which leaves its types exhaustive so the host must handle
each addition. That feature is for the host only and is outside this rule: a crate that turns it on may break on any
later 2.x, so a plugin never turns it on. `tests/sdk.rs` builds a pinned author crate, `tests/pinned`, against this
SDK and against the additions a later 2.x makes (the `next` feature), so a change that breaks that source fails the
SDK's own tests.
