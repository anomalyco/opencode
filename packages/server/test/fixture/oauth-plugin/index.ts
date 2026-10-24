import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "test.oauth",
  async setup(ctx) {
    await ctx.integration.transform((editor) => {
      editor.update("test-oauth", (integration) => {
        integration.name = "Test OAuth"
      })
      editor.method.update({
        integrationID: "test-oauth",
        method: { id: "device", type: "oauth", label: "Test OAuth" },
        authorize: async () => ({
          mode: "auto",
          url: "https://example.invalid/device",
          instructions: "Enter the device code",
          callback: new Promise(() => {}),
        }),
      })
    })
  },
})
