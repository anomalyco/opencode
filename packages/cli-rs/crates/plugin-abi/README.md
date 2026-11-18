# opencode-plugin-abi

The SDK of native TUI plugins for `opencode-native`. A plugin is a shared library (`.so`, `.dylib`, `.dll`) that
depends on this crate alone and exports itself with `plugin!`, which holds every `unsafe` the C ABI needs.
[`docs/plugins.md`](../../docs/plugins.md) explains how plugins work, [`docs/plugin-abi.md`](../../docs/plugin-abi.md)
is the reference, and `cargo doc -p opencode-plugin-abi --open` documents every type.

## Quick start

This plugin adds a command, "Say hello" in the palette and `/hello`, that shows a toast, and a `hello` at the end of
the home screen's footer that runs the command when clicked. It is `crates/plugin/examples/hello`, which the tests
build and load.

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

The crate is not on crates.io. The commit of a build is the `commit=` of the `cli starting` line in its log
(`opencode-native debug paths` prints the `log` directory). A build of your own checkout logs `commit=unknown`: use
`opencode-plugin-abi = { path = "<checkout>/packages/cli-rs/crates/plugin-abi" }` instead. Edition 2024 needs Rust
1.85 or newer.

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

`"example.hello"` is the plugin's ID (`plugin!(setup)` takes the package name instead). It names the plugin in
`/plugins` and `cli.json`, and scopes its storage keys. Build and install it:

```sh
cargo build --release
mkdir -p ~/.config/opencode/plugins/hello
cp target/release/libopencode_hello.so ~/.config/opencode/plugins/hello/plugin.so
```

On macOS the library is `libopencode_hello.dylib`, installed as `plugin.dylib`; on Windows `opencode_hello.dll`, as
`plugin.dll`. Start `opencode-native`: the footer ends in `hello`, and `/hello` shows the toast. A new build copied
over the installed one replaces the running plugin.

Other places work too ([Where plugins are found](../../docs/plugins.md#where-plugins-are-found)). A project's
`.opencode/plugins/` runs a plugin only once you approve it in `/plugins`, and asks again when the library changes.
Or name the library in the `plugins` list of `~/.config/opencode/cli.json`; the object form passes `options`, which
setup reads as JSON text from `Setup::options()`:

```json
{
  "plugins": [
    { "package": "/home/me/src/opencode-hello-plugin/target/release/libopencode_hello.so", "options": { "loud": true } }
  ]
}
```

While you work, `opencode-native plugin dev <crate dir>` builds, runs and reloads the plugin for you, and
`opencode-native plugin test <crate dir>` prints its screen with no server
([`plugin dev` and `plugin test`](../../docs/plugins.md#plugin-dev-and-plugin-test)). When a plugin fails, `/plugins`
shows why ([Failures](../../docs/plugins.md#failures)).

**Keep the default `panic = "unwind"`.** The SDK catches a panic only when it unwinds, on the host's calls and on the
threads `Setup::spawner` starts, and the plugin then fails with the panic logged. The SDK silences the plugin's panic
hook for the whole process, so a panic on a thread from `std::thread::spawn` ends that thread silently while the
plugin stays active. Start threads with the `Spawner`.

A plugin in C uses `include/opencode_plugin.h` instead of this crate, as `crates/plugin/examples/c/plugin.c` does. On
Linux and macOS: `cc -shared -fPIC -I<checkout>/packages/cli-rs/crates/plugin-abi/include plugin.c -o plugin.so`
(`plugin.dylib` on macOS).

## Requests and waiting

`Host::try_fetch` and `Host::try_foreground` return `Result<RequestId, String>`. An `Err` is a request the host did
not take, as when waiting effects fill its queue, and no reply comes for it. An ID always gets its one reply. To wait
for a reply or a dialog's answer in a straight line, start a task with `Setup::tasks`
([Waiting](../../docs/plugins.md#waiting-tasks-await-and-timers)).

## Compatibility

The host is ABI 2.0 and loads plugins of ABI 2.x. A plugin of another major is refused with "plugin ABI 3.0 is not
supported: … rebuild the plugin against opencode-plugin-abi 2". A plugin built with a later 2.x SDK loads on an older
2.x host. One that needs a newer host says so, `plugin!(id = "my.plugin", requires_minor = 1, setup)`, and an older
host refuses it and says to update `opencode-native`. [Versions](../../docs/plugin-abi.md#versions) has the rules.

### Optional features

A host lists its optional features in `Read::abi().features`, and `Abi::has_feature` asks for one. A plugin that
cannot work without one says `plugin!(id = "my.plugin", requires = ["focus-input"], setup)`, and a host without it
refuses the plugin at load. A plugin that can work without it checks and falls back.

| Feature | Constant | What it adds |
| --- | --- | --- |
| `image-bounds` | `IMAGE_BOUNDS` | The host states the bounds of the images it decodes |
| `focus-input` | `FOCUS_INPUT` | `Host::focus` focuses a `Node::Input` or `Node::Scroll` with an id, as a click does: typing goes to the field, and arrows and page keys scroll the scroll. Without it a field takes the focus only from a click |
| `fence-node` | `FENCE_NODE` | `Node::fence()` in a fence claim's tree: the fence as the host's code view draws it. Lower it for a host without the feature with `view.or(Node::fence(), \|view\| ...)`; the SDK refuses a tree that still holds it |

Where a dialog sits needs no feature: `Select::centered`, and `size` and `centered` on `Alert` and `Confirm`. A host
that does not know them places the dialog as usual.

### Source compatibility within 2.x

Source that builds on the 2.0 SDK builds on every later 2.x SDK. So every contract type a later 2.x may extend is
`#[non_exhaustive]` to the plugin's crate:

- A struct literal does not compile, even with `..Default::default()`. Start from the constructor or `Default`, and
  use the setters, one per field: a value takes anything that converts (`.title("Say hello")`), an optional field the
  value itself (`.slash("hello")`), a flag nothing (`.palette()`), and a list anything that iterates (`.keys([..])`).
  For an existing `Option` or `bool`, use `.maybe(focus, Select::focus)` and `.when(centered, Panel::centered)`. For
  example: `Fetch::new("GET", path).query([("limit", "20")])`,
  `Layout::default().absolute(Absolute::new().top(0).right(1).z(10))`.
- A `v2::Node` is built with its constructors (`Node::column`, `row`, `text`, `scroll`, `list`, `input`, `diff`,
  `code`, `image`, `markdown`, `spinner`, `canvas`, `slot`, `keep`, `fence`) and setters (`with_id`, `bg`, `border`,
  …). A variant pattern needs `..`: `Node::Keep { key, .. }`.
- A `match` on a contract enum (`interact::Event`, `claim::Part`, `v2::Cause`, `SessionStatus`, …) needs a `_` arm,
  and a pattern of an event's fields needs `..`: `Event::Paste { text, .. }`.
- What the host fills (`SurfaceInput`, `Geometry`, `Session`, …) is read as any struct is.
- Struct variants a plugin builds (a scroll verb, a target, a composer edit, an anchor) do not grow; a later 2.x adds
  a variant instead. `Rgba`, `Edges`, `Sides`, the rects and `ThemeMode` stay open.
- `plugin!`'s table is built by the SDK (`runtime::table`), so an entry a later 2.x appends breaks nothing.

On the wire, a later 2.x adds only optional fields, request types the host sends only to a library of that minor,
and node kinds an author lowers for an older host with `v2::View::or`.

The crate's `host` feature, for the host's own build, keeps the types exhaustive so the host must handle each
addition. It is outside this promise: a plugin never turns it on. `tests/sdk.rs` builds a pinned author crate,
`tests/pinned`, against this SDK and against what a later 2.x adds (the `next` feature), so a change that breaks that
source fails the SDK's tests.
