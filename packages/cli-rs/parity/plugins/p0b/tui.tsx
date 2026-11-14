// The P0b test plugin, TypeScript side: one line appended to the `app` slot that shows what the small reads of ABI
// 1.6 answer: the claim's own width (`onSizeChange`), the session tabs, a command's keys, the model's variants and the
// pending keys. parity/scenarios/P.0b/reads.app.ts loads this directory through the cli.json `plugins` entry; the
// Rust TUI skips that entry and registers its Rust twin (`p0b_plugin` in crates/tui/tests/all/app.rs).
import { createSignal } from "solid-js"
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.p0b",
  setup(context: Context) {
    context.ui.slot({
      append: "app",
      render: () => {
        const [width, setWidth] = createSignal(0)
        const line = () =>
          [
            `p0b: w${width()}`,
            `tabs ${context.ui.tabs.enabled()} ${context.ui.tabs.list().length}`,
            `keys ${context.keymap.shortcuts("command.palette.show").join(",")}`,
            `variants ${context.ui.model.variant.list().length}`,
            `pending ${context.keymap.pending().length}`,
          ].join(" ")
        return (
          <box
            paddingLeft={2}
            onSizeChange={function () {
              setWidth(this.width)
            }}
          >
            <text fg={context.theme.text.muted}>{line()}</text>
          </box>
        )
      },
    })
  },
}
