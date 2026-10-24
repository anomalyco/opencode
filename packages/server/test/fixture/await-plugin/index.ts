import { Plugin } from "@opencode/plugin"

// Registers only after a delay so an inventory read that does not await plugin
// activation can observe an empty list before this plugin becomes available.
export default Plugin.define({
  id: "opencode.test.await",
  async setup(ctx) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await ctx.command.transform((editor) =>
      editor.add({
        name: "await-test",
        description: "await plugin activation before listing",
        execute: async () => {},
      }),
    )
  },
})
