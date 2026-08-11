import { createProviderPlugin } from "./factory"

export const GatewayPlugin = createProviderPlugin({
  id: "opencode.provider.gateway",
  package: "@ai-sdk/gateway",
  load: async () => {
    const { createGateway } = await import("@ai-sdk/gateway")
    return (options) => createGateway(options)
  },
})
