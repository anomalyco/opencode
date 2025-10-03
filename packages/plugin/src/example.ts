import { Plugin } from "./index"
import { tool } from "./tool"

export const ExamplePlugin: Plugin = async (ctx) => {
  return {
    permission: {},
    tool: {
      mytool: tool({
        description: "This is a custom tool tool",
        args: {
          foo: tool.schema.string().describe("foo"),
        },
        async execute(args) {
          return {
            title: "Greeting",
            output: `Hello ${args.foo}!`,
            metadata: {
              length: args.foo.length,
            },
          }
        },
      }),
    },
    async "chat.params"(_input, output) {
      output.topP = 1
    },
  }
}
