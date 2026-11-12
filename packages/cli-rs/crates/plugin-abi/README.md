# opencode-plugin-abi

The SDK of native TUI plugins for `opencode-native`. A plugin is a shared library that depends on this crate alone and
exports itself with `export_plugin!`. The host loads it at startup and again when it changes. The design, the
lifecycle and the callback rules are in [`docs/P.4.md`](../../docs/P.4.md). Every type is documented in the rustdoc
(`cargo doc -p opencode-plugin-abi --open`).

Plugins load on Linux and macOS. The host opens libraries with `dlopen`, so on Windows every plugin fails to load.

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

The crate is not on crates.io. Cargo finds it inside the repository by its name. A path to a checkout also works:
`opencode-plugin-abi = { path = "<checkout>/packages/cli-rs/crates/plugin-abi" }`. Edition 2024 needs Rust 1.85
or newer. Keep the default `panic = "unwind"`: the SDK catches a plugin's panics only when they unwind.

`src/lib.rs`:

```rust
use opencode_plugin_abi::{Click, Command, Node, Placement, Render, Setup, Span, Toast, Variant, export_plugin};

fn setup(setup: &mut Setup) -> Result<(), String> {
    // A command in the palette and as `/hello`.
    setup.command(
        Command {
            name: "hello.greet".to_owned(),
            title: "Say hello".to_owned(),
            slash: Some("hello".to_owned()),
            palette: true,
            ..Command::default()
        },
        |host, _input| host.toast(Toast::new(Variant::Success, "Hello from a plugin")),
    );
    // A line at the end of the home screen's footer; a click runs the command.
    setup.slot(Placement::append("home.footer"), |_read, _input, _changed| {
        let text = Node::text([Span::new("hello").fg("text.muted")]);
        Render::Show(text.on_click(Click::command("hello.greet", None)))
    });
    Ok(())
}

export_plugin!("example.hello", setup);
```

`"example.hello"` is the plugin's ID. It names the plugin in `/plugins` and in `cli.json`, and it scopes the plugin's
storage keys. Build the library:

```sh
cargo build --release
```

The library is `target/release/libopencode_hello.so` (`.dylib` on macOS). Install it in one of these ways:

- Copy it to `plugin.so` (`plugin.dylib` on macOS) in a directory of its own under a `plugins` directory. The
  global one is `~/.config/opencode/plugins/` (`$OPENCODE_CONFIG_DIR/plugins/` when that is set). The project's is
  `.opencode/plugins/` in the project root, or in any directory between the root and the working directory:

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

Open `/plugins` to see the plugin's state. External plugins are listed under TUI, built-ins only after `ctrl+a`.
Enter disables or enables the selected plugin. A plugin that failed has an `x`, `failed` in its row, and a toast
"Plugin failed: example.hello" with "Open plugins". Space on its row ("view error") shows the error, such as a
setup's `Err`, a panic's message, or why the library was refused; on a library that never loaded, Enter shows it.
The log file in `~/.local/share/opencode/log/` has the same errors, and each request the plugin answered with an
error.

## Which binaries load

A plugin binary carries its ABI version. The host, ABI 1.4, loads every 1.x binary:

| Built with | Loads | What the host sends it |
| --- | --- | --- |
| The 1.0 SDK (the 1.0 table, without `describe`) | yes | The requests of 1.0 to 1.3, as below. The host learns the plugin's ID by running setup once at load and destroying that instance; what that instance asks for is dropped |
| The 1.1 to 1.3 SDK | yes | The requests of 1.0 to 1.3: fences, slots and routes draw styled rows |
| The 1.4 SDK | yes; a 1.3 host refuses it, naming both versions | The 1.4 requests |
| A 2.x SDK | no: "plugin ABI 2.0 is not supported: … rebuild the plugin against opencode-plugin-abi 1" | — |

A binary of an older SDK keeps the safety of its own SDK. A 1.3 `Waker` is a raw pointer to the host, and so is
the `Waker` of a 1.4 build from before `Waker` became `Clone`. Such a plugin must stop its threads before its state
drops; a 1.4 build of today's SDK cannot wake a host that is gone.

## Moving from the 1.3 SDK to 1.4

A 1.3 plugin keeps working unbuilt. To rebuild it on the 1.4 SDK, change:

- `Setup` has a lifetime, `Setup<'a>`. `fn setup(setup: &mut Setup) -> Result<(), String>` still compiles.
- `Setup::host()` returns `&dyn Host` for setup only, and a callback cannot keep it (the compiler refuses). Each
  callback gets the host as an argument instead: a render gets `&dyn Read`, which only reads, and a command, event,
  reply, mount or wake handler gets `&dyn Host`, which also has effects.
- `Host` is a trait now, not a struct. `storage_get` returns `Option<serde_json::Value>`, not JSON text.
  `storage_set(key, value)` takes a `serde_json::Value` and returns nothing. `toast(Toast)` takes a `Toast`, as in
  `Toast::new(Variant::Info, "text")`; the 1.3 `Toast` enum is `Variant`. `theme_mode()` returns `ThemeMode`, dark on a
  host without one. `log` is gone.
- `Host::waker()` is `Setup::waker()`. `Waker` is `Clone`, not `Copy`. The host revokes it before your
  `on_dispose` callbacks run, so a late `wake` does nothing.
- `command(command, |input| …)` is `command(command, |host, input| …)`.
- `code_block(language, |fence| -> Option<Vec<Line>>)` is `code_block(language, |read, fence| -> Fenced)`: `None`
  is `Fenced::Code`, `Some(lines)` is `Fenced::Lines { lines, fg: None, drag: false }`. `Fence::streaming` now means
  only that the message streams; whether the fence has closed is `Fence::closed`. `Fence` also has `key` and `width`.
- `slot(kind, path, |session_id| rows)` is `slot_lines(kind, path, |session_id| rows)`, and `route(name, || rows)` is
  `route_lines(name, || rows)`. These keep the 1.3 rows. The 1.4 forms are `slot(Placement, |read, input, changed|
  -> Render)` and `route(name, |read, changed| -> Render)`, which draw nodes and get what changed.
- `Span::fg` takes `impl Into<Color>`: a `&'static str`, a `String` or an `Rgba`. Pass a borrowed `&str` as
  `.to_owned()`. `Command` and `Span` have new fields, so a struct literal of either needs `..Default::default()`.
- Clean up in `Setup::on_dispose(|host| …)`, which runs when the plugin is disabled, unloaded, reloaded, when its
  setup fails, and when the TUI exits.
