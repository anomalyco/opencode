# F01: plugin clicks ignore a right-click release

## TypeScript

The built-in plugins act from `onMouseUp`, whatever the button: the home footer's MCP and failed-plugin counts
(`packages/tui/src/feature-plugins/home/footer.tsx:24,64`), the sidebar's MCP rows
(`feature-plugins/sidebar/mcp.tsx:56`), and the sidebar footer's card and location
(`feature-plugins/sidebar/footer.tsx:48,66,102`). OpenTUI Core delivers
the release of any button to `onMouseUp`, so releasing a right-click (or middle click) over them runs the action.
The sidebar's fold headers use `onMouseDown` (`sidebar/mcp.tsx:29`, `sidebar/todo.tsx:25`), also for any button.

## Rust

A plugin node's `Click` (`crates/plugin-abi`, `abi::Click`) runs on `MouseEventKind::Up(MouseButton::Left)`, or on
`MouseEventKind::Down(MouseButton::Left)` for `Click::on_down` (`crates/plugin/src/node.rs`). Other buttons do
nothing, for the built-ins and for every plugin of the one API.

## Reason

The same rule as `DLG35-select-right-click.md`: a right-click is not a request to act, and it can run an action the
user did not ask for (O-41). The left-click path is the same on both sides.
