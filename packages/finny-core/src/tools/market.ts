import { tool } from "@opencode-ai/plugin"
import { query } from "@finny-ai/integrations/market"

export const market = tool({
  description: "Query market data from the finny server",
  args: {
    query: tool.schema.string(),
  },
  async execute(args) {
    const data = await query({ query: args.query })
    return JSON.stringify(data, null, 2)
  },
})
