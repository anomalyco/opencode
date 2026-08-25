import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Test whether the crawler custom tool is loaded correctly.",
  args: {},
  async execute() {
    return "Crawler custom tool is connected successfully."
  },
})