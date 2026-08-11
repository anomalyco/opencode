import { createProviderPlugin } from "./factory"

export const MistralPlugin = createProviderPlugin({
  id: "opencode.provider.mistral",
  package: "@ai-sdk/mistral",
  load: async () => {
    const { createMistral } = await import("@ai-sdk/mistral")
    return (options) => createMistral(options)
  },
})
