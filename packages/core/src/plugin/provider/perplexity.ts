import { createProviderPlugin } from "./factory.js"

export const PerplexityPlugin = createProviderPlugin({
  id: "opencode.provider.perplexity",
  package: "@ai-sdk/perplexity",
  load: async (options) => {
    const { createPerplexity } = await import("@ai-sdk/perplexity")
    return createPerplexity(options)
  },
})
