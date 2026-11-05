# DLG10: a failed open from a link click shows a toast

TypeScript: the OAuth views draw the authorization URL with `Link` (`packages/tui/src/ui/link.tsx:18-34`), whose
`onMouseUp` calls `openUrl(...).catch(() => {})`. A click that cannot start the browser does nothing.

Rust: a plain click on the URL runs the same open action as Enter ("open link enter",
`crates/tui/src/dialogs/integration/mod.rs`, `link`). It opens through `Local::open_url`, and a failure shows the
Enter action's "Could not open the browser" toast. A click that ends a text selection does not open the link.

Reason: one open path for the click and Enter, which tests replace through `Local::open_url`. The toast tells the
user to copy the URL instead of failing silently.
