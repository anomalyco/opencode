import { createProviderPlugin } from "./factory"

export const TogetherAIPlugin = createProviderPlugin({
  id: "opencode.provider.togetherai",
  package: "@ai-sdk/togetherai",
  load: async () => {
    const { createTogetherAI } = await import("@ai-sdk/togetherai")
    return (options) => createTogetherAI(options)
  },
})
