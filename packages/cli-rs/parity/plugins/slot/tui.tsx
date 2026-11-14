// The P.1 test plugin, TypeScript side: one line appended to the home.footer slot, after the footer built-in, and
// one in session.composer.top, above the composer. parity/scenarios/P.1/slot.app.ts and composer-top.app.ts load
// this directory through the cli.json `plugins` entry; the Rust TUI skips that entry and registers its Rust twin
// (`slot_plugin` in crates/tui/tests/all/app.rs).
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.slot",
  setup(context: Context) {
    context.ui.slot({
      append: "home.footer",
      render: () => (
        <box paddingLeft={2}>
          <text fg={context.theme.text.muted}>slot plugin: home.footer</text>
        </box>
      ),
    })
    context.ui.slot({
      append: "session.composer.top",
      render: () => (
        <box paddingLeft={2}>
          <text fg={context.theme.text.muted}>slot plugin: session.composer.top</text>
        </box>
      ),
    })
  },
}
