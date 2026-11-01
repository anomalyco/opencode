import { zai, type Settings } from "../zai.js"
import { config } from "../zai-settings.js"

export type { Settings } from "../zai.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return zai.configure(input).image(modelID, input.providerOptions)
}
