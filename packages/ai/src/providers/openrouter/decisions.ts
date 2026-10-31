import { openrouter, type Settings } from "../openrouter.js"
import { config } from "../openrouter-settings.js"

export type { Settings } from "../openrouter.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return openrouter.configure(input).decision(modelID, input.providerOptions)
}
