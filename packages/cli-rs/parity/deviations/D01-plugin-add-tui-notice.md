# D01: `plugin add` of a TUI package says how opencode-native loads it

TypeScript: `opencode plugin add <package>` installs the package with npm. A package with a server or GUI part goes in
the global `opencode.json` (`Plugin "<package>" installed and added to …`); a package with only a TUI part goes in
`cli.json` (`TUI plugin "<package>" installed and added to …/cli.json`), and the TS client loads it.

Rust: `opencode-native plugin add` runs the TypeScript CLI with the same arguments, stdio and exit code, as every
`plugin` subcommand does (D.1), but as a child it waits for rather than in its place. opencode-native loads a TUI
package named in `cli.json` from the cache that install filled, on its JS host (`F16-typescript-plugins-skipped`).
The JS host is on by default (O-166), and then it prints nothing more, as TS. Only when `OPENCODE_PLUGIN_JS` turns
it off (`0`, `false` or `off`), and the child succeeded and added an entry to `cli.json`, it prints one more line to
stdout for each: `opencode-native loads TUI plugin "<package>" on its JS host, which OPENCODE_PLUGIN_JS turns off: unset
it to load it. The TypeScript client (opencode) loads it as it is.` A build without the cargo feature `ts` (ts-feature)
has no JS host, so it prints for each, whatever the variable says: `opencode-native will not load TUI plugin
"<package>": this build has no TypeScript plugin support (built without the ts feature). The TypeScript client
(opencode) loads it as it is.` A failed add, or one that changed nothing, prints nothing more.

Reason: with the JS host turned off, "installed and added" alone would tell the user it works (field test FT-11). The
line is driven by `crates/cli/tests/delegate.rs` `adding_a_tui_package_says_how_opencode_native_loads_it`, with a fake
TypeScript binary: a P-CLI case of `plugin add` would install from npm on both sides.
