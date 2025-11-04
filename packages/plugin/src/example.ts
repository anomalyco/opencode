import { Plugin } from "./index"
import { tool } from "./tool"

export const ExamplePlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string().describe("foo"),
        },
        async execute(args) {
          return `Hello ${args.foo}!`
        },
      }),
    },
    "agent.complete": async (input, output) => {
      // Called when agent completes its work
      console.log("Agent completed!", {
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.messageID,
      })

      // You can access the full message result
      console.log("Message:", output.message)

      // Optional: Continue working with a new prompt
      // This will keep the agent working instead of going idle
      const shouldContinue = false // your logic here
      if (shouldContinue) {
        output.continue = true
        output.prompt = "Continue with next task..."
      }
    },
  }
}
