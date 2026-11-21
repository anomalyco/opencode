# opencode-plugin-abi

The TUI plugin contract of `opencode-native` and its Rust SDK. The built-in plugins (`crates/tui/src/plugins`,
`crates/latex`, `crates/mermaid`) are linked plugins on it, the Luau carrier converts a Luau plugin's calls to its
types, and the pipe carrier sends them to the JS host as JSON, whose schema is `schema/v2.json`. Native plugin
libraries do not load; third-party native code may return as a supervised helper process.
[`docs/plugins.md`](../../docs/plugins.md) explains how plugins work, [`docs/plugin-abi.md`](../../docs/plugin-abi.md)
is the reference, and `cargo doc -p opencode-plugin-abi --open` documents every type.

A linked plugin is an `abi::Plugin { id, setup }`, where `setup` is `fn(&mut Setup) -> Result<(), String>`. The ID
names the plugin in `/plugins` and `cli.json`, and scopes its storage keys. When a plugin fails, `/plugins` shows why
([Failures](../../docs/plugins.md#failures)).

## Requests and waiting

`Host::try_fetch` and `Host::try_foreground` return `Result<RequestId, String>`. An `Err` is a request the host did
not take, as when waiting effects fill its queue, and no reply comes for it. An ID always gets its one reply. To wait
for a reply or a dialog's answer in a straight line, start a task with `Setup::tasks`
([Waiting](../../docs/plugins.md#waiting-tasks-await-and-timers)).

## Optional features

A host lists its optional features in `Read::abi().features`, and `Abi::has_feature` asks for one. A plugin that can
work without one checks and falls back.

| Feature | Constant | What it adds |
| --- | --- | --- |
| `image-bounds` | `IMAGE_BOUNDS` | The host states the bounds of the images it decodes |
| `focus-input` | `FOCUS_INPUT` | `Host::focus` focuses a `Node::Input` or `Node::Scroll` with an id, as a click does: typing goes to the field, and arrows and page keys scroll the scroll. Without it a field takes the focus only from a click |
| `fence-node` | `FENCE_NODE` | `Node::fence()` in a fence claim's tree: the fence as the host's code view draws it. Lower it for a host without the feature with `view.or(Node::fence(), \|view\| ...)`; the SDK refuses a tree that still holds it |

Where a dialog sits needs no feature: `Select::centered`, and `size` and `centered` on `Alert` and `Confirm`. A host
that does not know them places the dialog as usual.

## Building values

Without the crate's `host` feature, every contract type a later 2.x may extend is `#[non_exhaustive]`: build values
with the constructors and setters (`Fetch::new("GET", path).query([("limit", "20")])`, `Node::column`, `with_id`, …),
and give a `match` on a contract enum a `_` arm. The workspace takes the crate with `host`, so the host must handle
each addition.
