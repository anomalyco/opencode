# Desktop terminal extension

`TerminalDesktop` is the built-in renderer extension for workspace terminals.
It uses only the public Desktop plugin SDK, client, and shared UI packages.

- Ghostty, PTY connections, terminal tabs, focus, titles, and scrollback live here.
- `session.auxiliary` places the terminal in the host's side or bottom dock.
  `session.mobile.actions` supplies mobile navigation.
- The host owns per-session visibility, docking, resize geometry, and the console font.
- PTYs and cached surfaces remain workspace-scoped. Switching sessions in one
  workspace retains the mounted surface and connection.
- `terminal.toggle`, `terminal.new`, and `terminal.close` retain their existing
  command references and user keybind overrides.
- Schema-aware storage imports the previous workspace `terminal` key. Titles,
  terminal IDs, active tabs, dimensions, cursor, and the saved scrollback tail survive.
- Disposing the renderer closes its connections and snapshots at most 2,000
  scrollback rows plus the screen. It does not terminate the server's PTY.
  Closing a terminal tab explicitly removes that PTY.

Run `bun typecheck` and `bun test` from this package. Browser-backed serializer,
mouse, key, and focus checks live in `packages/app/test-browser/terminal-*.test.ts`.
The isolated native output benchmark is documented in
`packages/app/e2e/performance/terminals/README.md`.
