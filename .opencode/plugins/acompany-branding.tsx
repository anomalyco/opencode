/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes } from "@opentui/core"
import { createMemo } from "solid-js"
import { homedir } from "node:os"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

// Slots:
// - home_logo (mode=replace): replaces upstream's animated OpenCode logo with the SecureCode wordmark.
// - sidebar_footer (mode=single_winner): wins over upstream's internal:sidebar-footer (order=100)
//   because we default to order=0. We render the same path + version stamp as upstream but with
//   the "•Acompany SecureCode" wordmark instead of "•OpenCode". Getting started box is dropped
//   because customer-provisioned LiteLLM config makes hasProviders() = true (it never shows anyway).
// home_footer is intentionally left to upstream's internal:home-footer plugin so directory / MCP
// status / version stay visible.

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

const home = homedir()

function SidebarFooter(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const path = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    const stripped = home && dir.startsWith(home) ? "~" + dir.slice(home.length) : dir
    const text = props.api.state.vcs?.branch ? stripped + ":" + props.api.state.vcs.branch : stripped
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  })

  return (
    <box gap={1}>
      <text>
        <span style={{ fg: theme().textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme().text }}>{path().name}</span>
      </text>
      <text fg={theme().textMuted}>
        <span style={{ fg: brandRed }}>•</span>{" "}
        <span style={{ fg: brandRed }}>
          <b>A</b>
        </span>
        <span style={{ fg: brandWhite }}>company</span> <span style={{ fg: brandWhite }}>SecureCode</span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
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
      sidebar_footer() {
        return <SidebarFooter api={api} />
      },
    },
  }
  api.slots.register(slot)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "acompany-branding",
  tui,
}

export default plugin
