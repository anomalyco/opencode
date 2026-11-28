import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "greeting",
  async setup(ctx) {
    await ctx.command.transform((editor) =>
      editor.add({
        name: "greet",
        description: ctx.options.description,
        execute: async () => {},
      }),
    )
  },
})
