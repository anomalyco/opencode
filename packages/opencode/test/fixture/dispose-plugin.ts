export default async () => ({
  dispose: async () => {
    const marker = process.env.OPENCODE_TEST_PLUGIN_DISPOSE_MARKER
    if (!marker) throw new Error("OPENCODE_TEST_PLUGIN_DISPOSE_MARKER is required")
    await Bun.write(marker, "disposed")
  },
})
