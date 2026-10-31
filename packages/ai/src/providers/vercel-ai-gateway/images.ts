import { vercelAIGateway, type Settings } from "../vercel-ai-gateway.js"
import { config } from "../vercel-ai-gateway-settings.js"

export type { Settings } from "../vercel-ai-gateway.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return vercelAIGateway.configure(input).image(modelID, input.providerOptions)
}
