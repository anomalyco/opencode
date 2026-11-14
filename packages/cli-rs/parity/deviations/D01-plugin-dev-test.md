# D01: `plugin dev` and `plugin test`

TypeScript: `opencode plugin` has `list`, `add`, `check`, `update` and `remove`. `opencode plugin dev` and
`opencode plugin test` are unknown subcommands.

Rust: `opencode-native plugin dev <dir> [arguments of the TUI]` builds the native plugin crate in `<dir>` with cargo,
runs the TUI with its library beside the configured plugins, and builds it again after a change in the crate; the TUI
reloads the new library. `opencode-native plugin test <library, crate or plugin dir> [--route NAME] [--size WxH]
[--command NAME[=INPUT]] [--wait TEXT]...` loads a native plugin into the TUI on the headless renderer, with no server,
and prints a text frame of Home or of the plugin's route, then one after each step; it fails when the plugin fails,
the route is not its own, or a command does not run. Each takes `-h`. Neither is in `--help`: `main` takes them
before it parses the line, so the command table still matches the TypeScript tree (`src/tests/tree.rs`).
`plugin list`, `add`, `check`, `update` and `remove` still go to the TypeScript CLI.

Reason: native plugins exist only in opencode-native (rich-plugins synthesis 4.7, phase P4). Their authors need to
rebuild and reload a plugin while the TUI runs, and to render a surface in a test without a terminal or a server.
