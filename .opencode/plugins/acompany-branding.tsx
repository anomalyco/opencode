/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

const brandRed = RGBA.fromHex("#D4143C")
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
    home_footer() {
      return (
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0}>
          <box flexGrow={1} />
          <box flexShrink={0} flexDirection="row">
            <text fg={brandRed} attributes={TextAttributes.BOLD}>
              A
            </text>
            <text fg={brandWhite}>company</text>
          </box>
        </box>
      )
    },
    sidebar_footer() {
      return (
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0}>
          <text>
            <span style={{ fg: brandRed }}>•</span>{" "}
            <span style={{ fg: brandRed }}>
              <b>A</b>
            </span>
            <span style={{ fg: brandWhite }}>company</span>{" "}
            <span style={{ fg: brandWhite }}>SecureCode</span>
          </text>
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
