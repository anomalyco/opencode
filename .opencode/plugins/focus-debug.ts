import type { Plugin } from "@opencode-ai/plugin"

const FocusDebugPlugin: Plugin = async () => {
  console.log("[focus-debug] plugin loaded")

  return {
    event: async ({ event }) => {
      if (event.type === "tui.focus.gained") {
        console.log("[focus-debug] window FOCUSED at", new Date().toISOString())
        return
      }
      if (event.type === "tui.focus.lost") {
        console.log("[focus-debug] window BLURRED at", new Date().toISOString())
        return
      }
    },
  }
}

export default FocusDebugPlugin
