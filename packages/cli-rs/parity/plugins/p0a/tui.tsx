// The P0a test plugin, TypeScript side (rich plugins, ABI 1.5): F6 asks `dialog.confirm` and toasts the answer, F7
// shows `dialog.alert` and toasts once it closes, F8 inserts text into the focused composer, as npm plugins do through
// `renderer.currentFocusedEditor`, and a styled box is appended to home.footer. parity/scenarios/P.1/p0a-*.app.ts load
// this directory through the cli.json `plugins` entry; the Rust TUI skips that entry and registers its Rust twin
// (`p0a_plugin` in crates/tui/tests/all/app.rs).
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.p0a",
  setup(context: Context) {
    const theme = context.theme
    const toast = (message: string) => context.ui.toast.show({ message })
    context.keymap.layer(() => ({
      commands: [
        {
          bind: "f6",
          title: "Parity confirm",
          run: async () => {
            const answer = await context.ui.dialog.confirm({
              title: "Delete the draft?",
              message: "It cannot be undone.",
              label: { confirm: "delete" },
            })
            if (answer !== undefined) toast(`answered ${answer}`)
          },
        },
        {
          bind: "f7",
          title: "Parity alert",
          run: async () => {
            await context.ui.dialog.alert({ title: "Heads up", message: "The plugin says hello." })
            toast("alert closed")
          },
        },
        {
          bind: "f8",
          title: "Parity insert",
          run: () => {
            context.renderer.currentFocusedEditor?.insertText("inserted")
          },
        },
      ],
    }))
    context.ui.slot({
      append: "home.footer",
      render: () => (
        <box
          border
          borderStyle="rounded"
          borderColor={theme.border.base}
          title="p0a"
          titleAlignment="center"
          paddingLeft={2}
          paddingRight={1}
          overflow="hidden"
          width={24}
          height={5}
          minHeight={3}
          maxHeight={5}
          marginLeft={2}
        >
          <box flexDirection="row" border={["left"]} borderStyle="heavy" borderColor={theme.text.muted} paddingLeft={1}>
            <text fg={theme.text.base}>ruled</text>
          </box>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <text fg={theme.text.base}>alpha</text>
            <text fg={theme.text.base}>beta</text>
            <text fg={theme.text.base}>gamma</text>
            <text fg={theme.text.base}>delta</text>
          </box>
        </box>
      ),
    })
  },
}
