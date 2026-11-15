# D01: `plugin add` of a TUI package says opencode-native will not load it

TypeScript: `opencode plugin add <package>` installs the package with npm. A package with a server or GUI part goes in
the global `opencode.json` (`Plugin "<package>" installed and added to …`); a package with only a TUI part goes in
`cli.json` (`TUI plugin "<package>" installed and added to …/cli.json`), and the TS client loads it.

Rust: `opencode-native plugin add` runs the TypeScript CLI with the same arguments, stdio and exit code, as every
`plugin` subcommand does (D.1), but as a child it waits for rather than in its place. When the child succeeded and
added an entry to `cli.json`, it prints one more line to stdout for each:
`opencode-native will not load TUI plugin "<package>": it does not install or load TUI plugins named by npm package.
The TypeScript client (opencode) loads it. To try it in opencode-native, install the package as a directory under
<config>/plugins and set OPENCODE_PLUGIN_JS=1.` A failed add, or one that changed nothing, prints nothing more.

Reason: opencode-native skips TUI plugins named by npm package (`F16-typescript-plugins-skipped`), so "installed and
added" alone told the user it would work (field test FT-11). The line is driven by
`crates/cli/tests/delegate.rs` `adding_a_tui_package_says_opencode_native_will_not_load_it`, with a fake TypeScript
binary: a P-CLI case of `plugin add` would install from npm on both sides.
