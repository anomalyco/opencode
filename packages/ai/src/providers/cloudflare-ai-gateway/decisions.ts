import { cloudflareAIGateway, type Settings } from "../cloudflare-ai-gateway.js"
import { config } from "../cloudflare-ai-gateway-settings.js"

export type { Settings } from "../cloudflare-ai-gateway.js"

export const model = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return cloudflareAIGateway.configure(input).decision(modelID, input.providerOptions)
}
