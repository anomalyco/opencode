import { z } from "zod"
import { Tool } from "@/tool/tool"

export default Tool.define("test_describe", async () => {
  return {
    description: "Test tool to verify parameter descriptions are passed to LLM",
    parameters: z.object({
      message: z.string().describe("The message to process"),
      count: z.number().describe("Number of times to repeat the message"),
    }),
    async execute(args) {
      return Array(args.count).fill(args.message).join("\n")
    },
  }
})
