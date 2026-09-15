import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "acp-test-commands",
  async setup(ctx) {
    await ctx.command.transform((editor) => {
      editor.add({
        name: "ping",
        description: "Immediate action that admits no work",
        execute: async () => {},
      })
      editor.add({
        name: "pong",
        description: "Explicit immediate outcome",
        execute: async () => ({ type: "immediate" }),
      })
    })
  },
})
