import { minimax, type ImageSettings } from "../minimax.js"
import { config } from "../minimax-settings.js"

export type { ImageSettings as Settings } from "../minimax.js"

export const model = (modelID: string, settings?: ImageSettings) => {
  const input = config(settings)
  return minimax.configure(input).image(modelID, input.providerOptions)
}
