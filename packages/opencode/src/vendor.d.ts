// Type declarations for third-party globals used in this project

// AI SDK uses this global flag to suppress warning output to stdout
// See: https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
declare var AI_SDK_LOG_WARNINGS: boolean

// Type declarations for ai-gateway-provider (Cloudflare AI Gateway)
// Used in src/provider/provider.ts for the "cloudflare-ai-gateway" provider
declare module "ai-gateway-provider" {
  import type { LanguageModelV1 } from "ai"

  interface AiGatewayOptions {
    accountId: string
    gateway: string
    apiKey?: string
  }

  type AiGatewayProvider = (provider: UnifiedProvider) => LanguageModelV1

  interface UnifiedProvider {
    __brand: "unified-provider"
  }

  function createAiGateway(options: AiGatewayOptions): AiGatewayProvider

  export { createAiGateway, type AiGatewayOptions, type AiGatewayProvider, type UnifiedProvider }
}

declare module "ai-gateway-provider/providers/unified" {
  import type { UnifiedProvider } from "ai-gateway-provider"

  function createUnified(): (modelId: string) => UnifiedProvider

  export { createUnified }
}

declare module "@parcel/watcher/wrapper" {
  export function createWrapper(binding: unknown): typeof import("@parcel/watcher")
}
