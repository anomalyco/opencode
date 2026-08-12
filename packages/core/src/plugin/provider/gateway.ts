import { createProviderPlugin } from "./factory.js"

export const GatewayPlugin = createProviderPlugin({
  id: "opencode.provider.gateway",
  package: "@ai-sdk/gateway",
  load: async (options) => {
    const { createGateway } = await import("@ai-sdk/gateway")
    return createGateway(options)
  },
})
