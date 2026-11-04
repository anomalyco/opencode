# DLG11: the MCP servers dialog

## TypeScript

- `DialogMcp` keeps a `focused` server apart from the list's selection
  (`packages/tui/src/component/dialog-mcp.tsx:51,145`). The detail view replaces the `DialogSelect`
  (`<Show when={detail()}>`, `:136`), so Back mounts a new list on its first row while `focused` is still the
  failed server. The toggle title then reads `retry` over a row that is not the one space acts on.
  `initialServer` sets `focused` the same way without moving the list.
- The error view's scroll box (`dialog-error-details.tsx:114-124`, `maxHeight={20}`) takes its height from the
  wrapped error text.

## Rust

- The selection is the focused server. Back reopens the list on the failed server, and `show_server(initial)`
  selects `initial`, so the title, the hint, and space always follow the highlighted row.
- An opentui-rust `ScrollBox` takes no height from its content, so `error_details::view` sets it to the error's
  word-wrapped line count at the dialog's inner width, clamped to 1..20. It does not follow a later resize.

## Reason

The first is a TS inconsistency between the title and the row it acts on; Rust does not copy it. The second is
an opentui-rust layout difference. The `E.17b/mcp-error` fixture, a one-line error, is equal cell for cell.
