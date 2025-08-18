import { Plugin } from "./index"

export const ExamplePlugin: Plugin = async ({ app, client, $ }) => {
  return {
    permission: {},
    async "chat.params"(input, output) {
      output.topP = 1
    },
  }
}
