import { Plugin } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "config-promise-plugin",
  tui: true,
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("configured", (agent) => {
        agent.description = ctx.options.description
        agent.mode = "subagent"
      })
    })
  },
})
