import { Plugin } from "@opencode-ai/plugin/v2/tui"
import { useTheme } from "../../context/theme"

function View() {
  const { themeV2 } = useTheme()
  return (
    <box>
      <text fg={themeV2.text()}>
        <b>LSP</b>
      </text>
      <text fg={themeV2.text.subdued()}>LSP status unavailable</text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar-lsp",
  setup(context) {
    context.ui.slot("sidebar.content", () => <View />)
  },
})
