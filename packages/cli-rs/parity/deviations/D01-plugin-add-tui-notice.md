# D01: `plugin add` of a TUI package says how opencode-native loads it

TypeScript: `opencode plugin add <package>` installs the package with npm. A package with a server or GUI part goes in
the global `opencode.json` (`Plugin "<package>" installed and added to …`); a package with only a TUI part goes in
`cli.json` (`TUI plugin "<package>" installed and added to …/cli.json`), and the TS client loads it.

Rust: `opencode-native plugin add` runs the TypeScript CLI with the same arguments, stdio and exit code, as every
`plugin` subcommand does (D.1), but as a child it waits for rather than in its place. opencode-native loads a TUI
package named in `cli.json` from the cache that install filled, on its JS host (`F16-typescript-plugins-skipped`).
With the JS host on (`OPENCODE_PLUGIN_JS=1`) it prints nothing more, as TS. With it off, when the child succeeded and
added an entry to `cli.json`, it prints one more line to stdout for each:
`opencode-native loads TUI plugin "<package>" on its JS host, which is off: set OPENCODE_PLUGIN_JS=1 (with Bun
installed) to load it. The TypeScript client (opencode) loads it as it is.` A failed add, or one that changed nothing,
prints nothing more.

Reason: the JS host is off by default (O-151), so "installed and added" alone would tell the user it works (field test
FT-11). The line is driven by `crates/cli/tests/delegate.rs` `adding_a_tui_package_says_how_opencode_native_loads_it`,
with a fake TypeScript binary: a P-CLI case of `plugin add` would install from npm on both sides.
