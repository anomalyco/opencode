import { define } from "@opencode-ai/plugin/v2/promise"

export default define({
  id: "directory-plugin",
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("directory", (agent) => {
        agent.description = "Loaded from plugin directory"
        agent.mode = "subagent"
      })
    })
  },
})
