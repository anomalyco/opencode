import { Plugin } from "@opencode/plugin/tui"

// Renders every shell call itself and asks for an ungrouped transcript with
// reasoning shown.
export default Plugin.define({
  id: "fixture.tool-renderer",
  setup(context) {
    context.ui.layout({ transcript: { grouping: "none", thinking: "show" } })
    context.ui.tool("shell", (input) => {
      const part = () => context.data.session.part.get(input.sessionID, input.messageID, input.partID)
      const command = () => {
        const item = part()
        if (item?.type !== "tool" || typeof item.state.input === "string") return ""
        return String((item.state.input as { command?: unknown }).command ?? "")
      }
      return (
        <text>
          Custom {input.tool} row: {command()}
        </text>
      )
    })
  },
})
