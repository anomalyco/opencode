import { Plugin } from "./index.js"
import { tool } from "./tool.js"

export const ExamplePlugin: Plugin = async (_ctx) => {
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
    "ui.sidebar": async (_input, output) => {
      output.items.push({
        id: "ceo-settings",
        label: "CEO Settings",
        icon: "settings-gear",
        href: "/settings/ceo",
        order: 0,
      })
    },
  }
}
