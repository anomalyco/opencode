# DLG10: authorization links open with Enter, not a mouse click

TypeScript: the OAuth views draw the authorization URL with `Link` (`packages/tui/src/ui/link.tsx:18-34`), whose
`onMouseUp` calls `openUrl`. A plain click on the URL opens the browser.

Rust: the URL is a terminal hyperlink (OSC 8) in the link color, and has no click handler
(`crates/tui/src/dialogs/integration/mod.rs`, `link`). Enter ("open link enter") opens it through
`Local::open_url`, as in TS, and terminals that support OSC 8 open it on their own modified click. The cells
are the same.

Reason: a click handler would start a browser from the dialog's own mouse handling, which tests cannot
replace. Every opener goes through `Local::open_url`, which tests swap for a sink. Adding the click is a
small follow-up once a shared link widget exists (E.20 owns `features/links.rs`).
