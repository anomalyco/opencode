import { Plugin, usePlugin } from "@opencode-ai/plugin/tui"

function View() {
  const context = usePlugin()
  const theme = context.theme
  return (
    <box>
      <text fg={theme.text.default}>
        <b>LSP</b>
      </text>
      <text fg={theme.text.subdued}>LSP status unavailable</text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar-lsp",
  setup(context) {
    context.ui.slot("sidebar.content", () => <View />)
  },
})
