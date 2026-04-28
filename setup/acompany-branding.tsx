/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

// home_logo (mode=replace) のみを上書きしてホーム画面のロゴを SecureCode wordmark に差し替える。
// home_footer / sidebar_footer は upstream 内蔵の internal:* feature-plugin が directory / MCP /
// version 等の機能的な情報を表示しているため、上書きせず upstream に譲る。

const brandWhite = RGBA.fromHex("#F7F5EF")

const wordmarkRows = [
  " ███████╗ ███████╗  ██████╗ ██╗   ██╗ ██████╗  ███████╗      ██████╗  ██████╗   ██████╗  ███████╗",
  " ██╔════╝ ██╔════╝ ██╔════╝ ██║   ██║ ██╔══██╗ ██╔════╝     ██╔════╝ ██╔═══██╗  ██╔══██╗ ██╔════╝",
  " ███████╗ █████╗   ██║      ██║   ██║ ██████╔╝ █████╗       ██║      ██║   ██║  ██║  ██║ █████╗  ",
  " ╚════██║ ██╔══╝   ██║      ██║   ██║ ██╔══██╗ ██╔══╝       ██║      ██║   ██║  ██║  ██║ ██╔══╝  ",
  " ███████║ ███████╗ ╚██████╗ ╚██████╔╝ ██║  ██║ ███████╗     ╚██████╗ ╚██████╔╝  ██████╔╝ ███████╗",
  " ╚══════╝ ╚══════╝  ╚═════╝  ╚═════╝  ╚═╝  ╚═╝ ╚══════╝      ╚═════╝  ╚═════╝   ╚═════╝  ╚══════╝",
]

const slot: TuiSlotPlugin = {
  slots: {
    home_logo() {
      return (
        <box flexDirection="column">
          {wordmarkRows.map((row) => (
            <text fg={brandWhite} attributes={TextAttributes.BOLD}>
              {row}
            </text>
          ))}
        </box>
      )
    },
  },
}

const tui: TuiPlugin = async (api) => {
  api.slots.register(slot)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "acompany-branding",
  tui,
}

export default plugin
