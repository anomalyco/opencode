import { define } from "@moks/plugin/v2/promise"

export default define({
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
