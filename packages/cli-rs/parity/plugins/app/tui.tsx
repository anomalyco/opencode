// The P.1 `app` test plugin, TypeScript side: one line appended to the `app` slot, under the routes.
// parity/scenarios/P.1/app-home.app.ts and app-session.app.ts load this directory through the cli.json `plugins`
// entry; the Rust TUI skips that entry and registers its Rust twin (`app_plugin` in crates/tui/tests/all/app.rs).
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.app",
  setup(context: Context) {
    context.ui.slot({
      append: "app",
      render: () => (
        <box paddingLeft={2}>
          <text fg={context.theme.text.muted}>app plugin: app</text>
        </box>
      ),
    })
  },
}
