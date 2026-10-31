import { xai, type Settings } from "../xai.js"
import { config } from "../xai-settings.js"

export type { Settings } from "../xai.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return xai.configure(input).image(modelID, input.providerOptions)
}
