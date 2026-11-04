import { Plugin } from "@opencode/plugin/tui"
import { TextRenderable } from "@opentui/core"

// Reads a session through data.session.usage, data.session.goal and
// data.session.part.get, and renders a text part with ui.Markdown.
export default Plugin.define({
  id: "fixture.session-reads",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "probe",
      () => new TextRenderable(context.renderer, { content: "Probe fence rendered", height: 1 }),
    )
    context.ui.slot({
      append: "session.header",
      render: (input) => {
        const usage = () => context.data.session.usage(input.sessionID)
        const goal = () => context.data.session.goal(input.sessionID)
        return (
          <box flexDirection="column">
            <text>
              usage {usage()?.tokens ?? "none"} of {usage()?.limit ?? "none"} ({usage()?.percent ?? "none"}%)
            </text>
            <text>
              goal {goal()?.objective ?? "none"} [{goal()?.status ?? "none"}]
            </text>
          </box>
        )
      },
    })
    context.ui.slot({
      replace: "session.part.text",
      render: (input) => {
        const part = () => context.data.session.part.get(input.sessionID, input.messageID, input.partID)
        const content = () => {
          const item = part()
          return item?.type === "text" ? `Read ${input.partID}: ${item.text}` : ""
        }
        return <context.ui.Markdown content={content()} />
      },
    })
  },
})
