import { Plugin } from "../../packages/plugin/src/index"

export const ExamplePlugin: Plugin = async ({ app, client, $ }) => {
  return {
    permission: {},
    async "chat.params"(input, output) {
      output.topP = 1
    },
  }
}
