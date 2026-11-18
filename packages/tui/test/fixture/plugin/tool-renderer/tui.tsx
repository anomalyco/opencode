import { Plugin } from "@opencode/plugin/tui"
import { createMemo } from "solid-js"

// Registers a renderer for the FixtureTool tool on demand, so tests can watch
// the transcript fall back to the built-in view before registration, after
// dispose, and after the plugin is disabled.
export default Plugin.define({
  id: "fixture.tool-renderer",
  setup(context) {
    let dispose: (() => void) | undefined
    const register = () => {
      if (dispose) return
      dispose = context.ui.tool.register("FixtureTool", (input) => {
        const status = createMemo(() => input.part.state.status)
        const label = createMemo(() => {
          const metadata = input.part.state.status === "streaming" ? undefined : input.part.state.metadata
          return typeof metadata?.label === "string" ? metadata.label : ""
        })
        return (
          <text>
            Plugin tool {status()} {label()}
          </text>
        )
      })
    }
    context.keymap.layer(() => ({
      commands: [
        { id: "fixture.tool.register", title: "Register fixture tool", bind: "f9", run: register },
        {
          id: "fixture.tool.dispose",
          title: "Dispose fixture tool",
          bind: "f10",
          run: () => {
            dispose?.()
            dispose = undefined
          },
        },
      ],
    }))
    context.ui.toast.show({ message: "Fixture tool renderer ready" })
  },
})
