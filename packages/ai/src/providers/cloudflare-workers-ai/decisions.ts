import { cloudflareWorkersAI, type Settings } from "../cloudflare-workers-ai.js"
import { config } from "../cloudflare-workers-ai-settings.js"

export type { Settings } from "../cloudflare-workers-ai.js"

export const model = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return cloudflareWorkersAI.configure(input).decision(modelID, input.providerOptions)
}
