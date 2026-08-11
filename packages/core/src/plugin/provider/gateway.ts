import { createProviderPlugin } from "./factory"

export const GatewayPlugin = createProviderPlugin({
  id: "opencode.provider.gateway",
  package: "@ai-sdk/gateway",
  load: async (options) => {
    const { createGateway } = await import("@ai-sdk/gateway")
    return createGateway(options)
  },
})
