import { createProviderPlugin } from "./factory"

export const PerplexityPlugin = createProviderPlugin({
  id: "opencode.provider.perplexity",
  package: "@ai-sdk/perplexity",
  load: async (options) => {
    const { createPerplexity } = await import("@ai-sdk/perplexity")
    return createPerplexity(options)
  },
})
