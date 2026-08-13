import { createProviderPlugin } from "./factory.js"

export const DeepInfraPlugin = createProviderPlugin({
  id: "opencode.provider.deepinfra",
  package: "@ai-sdk/deepinfra",
  load: async (options) => {
    const { createDeepInfra } = await import("@ai-sdk/deepinfra")
    return createDeepInfra(options)
  },
})
