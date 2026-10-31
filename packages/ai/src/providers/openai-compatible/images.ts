import { openaiCompatible, type Settings } from "../openai-compatible.js"
import { config } from "../openai-compatible-settings.js"

export type { Settings } from "../openai-compatible.js"

export const model = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return openaiCompatible.configure(input).image(modelID, input.providerOptions)
}
