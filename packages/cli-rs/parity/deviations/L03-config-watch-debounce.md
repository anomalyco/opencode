# L03: `cli.json` reload is debounced

**TypeScript.** `ConfigProvider` (`packages/tui/src/config/index.tsx:363-371`) reloads on every `fs.watch` event
in the config directory, one reload after another.

**Rust.** `CliConfig::watch` uses the same 50 ms debounce as storage and `model.json`
(`crates/local/src/watch.rs`), so a temporary-file-and-rename write gives one reload.

**Reason.** The reloads TS runs for the intermediate events read the same file; only the last one shows. The
debounce removes redundant reads and no state is visible in between.
