import { Plugin } from "@opencode-ai/plugin/v2"

export default Plugin.define({
  id: "config-promise-plugin",
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("configured", (agent) => {
        agent.description = ctx.options.description
        agent.mode = "subagent"
      })
    })
  },
})
