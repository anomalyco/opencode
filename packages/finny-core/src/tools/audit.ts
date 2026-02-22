import { tool } from "@opencode-ai/plugin"
import { log } from "@finny-ai/integrations/audit"

export const audit = tool({
  description: "Log an audit event via the finny server",
  args: {
    event: tool.schema.string(),
    data: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
  },
  async execute(args) {
    const data = await log({ event: args.event, data: args.data })
    return JSON.stringify(data, null, 2)
  },
})
