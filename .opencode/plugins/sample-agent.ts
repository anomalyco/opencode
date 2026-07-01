export default {
  id: "sample-agent-plugin",
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("sample-plugin-agent", (agent) => {
        agent.description = "Example primary agent registered by .opencode/plugins/sample-agent.ts"
        agent.mode = "primary"
        agent.system = [
          "You are the sample plugin agent for this repository.",
          "Use this agent to verify that local plugin auto-discovery can add agents.",
          "Keep responses concise and explain which plugin registered you when asked.",
        ].join("\n")
      })
    })
  },
}
