import { openai, type Settings } from "../openai.js"
import { config } from "../openai-settings.js"

export type { Settings } from "../openai.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return openai.configure(input).image(modelID, input.providerOptions)
}
