import { createProviderPlugin } from "./factory.js"

export const CoherePlugin = createProviderPlugin({
  id: "opencode.provider.cohere",
  package: "@ai-sdk/cohere",
  load: async (options) => {
    const { createCohere } = await import("@ai-sdk/cohere")
    return createCohere(options)
  },
})
