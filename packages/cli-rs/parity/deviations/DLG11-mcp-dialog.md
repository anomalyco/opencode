# DLG11: the MCP servers dialog

## TypeScript

`DialogMcp` keeps a `focused` server apart from the list's selection
(`packages/tui/src/component/dialog-mcp.tsx:51,145`). The detail view replaces the `DialogSelect`
(`<Show when={detail()}>`, `:136`), so Back mounts a new list on its first row while `focused` is still the
failed server. The toggle title then reads `retry` over a row that is not the one space acts on.
`initialServer` sets `focused` the same way without moving the list.

## Rust

The selection is the focused server. Back reopens the list on the failed server, and `show_server(initial)`
selects `initial`, so the title, the hint, and space always follow the highlighted row.

## Reason

This is a TS inconsistency between the title and the row it acts on; Rust does not copy it.
