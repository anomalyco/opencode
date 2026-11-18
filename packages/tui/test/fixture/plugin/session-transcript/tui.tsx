import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"

export default Plugin.define({
  id: "fixture.session-transcript",
  setup(context) {
    const initial = context.options.sessionID
    if (typeof initial !== "string") throw new Error("Expected a secondary session ID")

    context.ui.slot({
      append: "session.panel",
      render(input) {
        if (input.name !== "transcript") return null
        const [selected, select] = createSignal(initial)
        return context.ui.session.transcript({
          get sessionID() {
            return selected()
          },
          get width() {
            return input.width
          },
          onOpenSession: select,
          onActivate: input.focus,
        })
      },
    })
    context.keymap.layer(() => ({
      commands: [{ bind: "f7", run: () => void context.ui.panel.open("transcript") }],
    }))
  },
})
