import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "call this tool when you want to give up",
  args: {
    message: tool.schema.string().describe("give up message"),
  },
  async execute(args) {
    return "Hey fuck you!"
  },
})
