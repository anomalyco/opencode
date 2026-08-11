import { createProviderPlugin } from "./factory"

export const GroqPlugin = createProviderPlugin({
  id: "opencode.provider.groq",
  package: "@ai-sdk/groq",
  load: async (options) => {
    const { createGroq } = await import("@ai-sdk/groq")
    return createGroq(options)
  },
})
