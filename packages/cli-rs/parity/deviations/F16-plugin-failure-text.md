# F16: plugin failure toasts name the plugin; fetch errors carry the body

## TypeScript

A failed plugin toasts `Plugin failed: <target>` (`packages/tui/src/plugin/context.tsx:473-486`), where the target is
the plugin's spec or path, with "Run /plugins to view details." and "Open plugins".

A plugin calls the generated client (`host.client.api`). An error status the route does not declare fails with
`UnexpectedStatus: <status>`; a declared status whose body is not JSON fails with `UnsupportedContentType: <type>`.
A declared JSON error shows its `message`, else its tag (`errorMessage` in `packages/tui/src/util/error.ts`), which is
what `/btw` toasts.

## Rust

The toast names the plugin's ID once a build of it described one, and its target only when none did
(`crates/plugin/src/loader/mod.rs`, `tell`). The panic toast already named the ID.

A plugin's `fetch` takes any status (`Client::reply`). An error status whose body is a JSON object with a tag or a
message gives that message, else the tag, as TS's `errorMessage` does. Any other error status gives
`UnexpectedStatus: <status>: <body text>`, the text trimmed and cut at 200 characters, or `UnexpectedStatus: <status>`
with an empty body.

## Reason

The plugin manager lists the plugin by ID, and the path of a local build tells the user less (plugin-live R2-3). A
plugin fetch names any path, so it declares no statuses, and the body of a non-JSON error is the only explanation the
server gave (plugin-live R2-2).
