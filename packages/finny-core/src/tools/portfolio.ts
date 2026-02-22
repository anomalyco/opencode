import { tool } from "@opencode-ai/plugin"
import { get } from "@finny-ai/integrations/portfolio"

export const portfolio = tool({
  description: "Get portfolio data from the finny server",
  args: {
    account: tool.schema.string().optional(),
  },
  async execute(args) {
    const data = await get({ account: args.account })
    return JSON.stringify(data, null, 2)
  },
})
