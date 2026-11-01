import { alibaba, type Settings } from "../alibaba.js"
import { config } from "../alibaba-settings.js"

export type { Settings } from "../alibaba.js"

export const model = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return alibaba.configure(input).image(modelID, input.providerOptions)
}
