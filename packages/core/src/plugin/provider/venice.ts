import { createProviderPlugin } from "./factory"

export const VenicePlugin = createProviderPlugin({
  id: "opencode.provider.venice",
  package: "venice-ai-sdk-provider",
  load: async () => {
    const { createVenice } = await import("venice-ai-sdk-provider")
    return (options) => createVenice(options)
  },
})
