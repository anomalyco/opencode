import { createProviderPlugin } from "./factory"

export const DeepInfraPlugin = createProviderPlugin({
  id: "opencode.provider.deepinfra",
  package: "@ai-sdk/deepinfra",
  load: async () => {
    const { createDeepInfra } = await import("@ai-sdk/deepinfra")
    return (options) => createDeepInfra(options)
  },
})
