# L03: `cli.json` reload is debounced

**TypeScript.** `ConfigProvider` (`packages/tui/src/config/index.tsx:363-371`) reloads on every `fs.watch` event
in the config directory, one reload after another, and applies each result.

**Rust.** The settings module (`crates/tui/src/dialogs/settings.rs`, `install_reload`) starts
`CliConfig::watch` on the config directory when the TUI has real roots. The watch uses the same 50 ms debounce as
storage and `model.json` (`crates/local/src/watch.rs`), so a temporary-file-and-rename write gives one reload.
The reload runs `CliConfig::get` on the same worker thread as settings writes, so a reload and a write land in
the order they ran. A reload that resolves to the config already shown changes nothing.

**Reason.** The reloads TS runs for the intermediate events read the same file; only the last one shows. The
debounce removes redundant reads and no state is visible in between.
