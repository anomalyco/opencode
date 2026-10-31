import { digitalocean, type Settings } from "../digitalocean.js"
import { config } from "../digitalocean-settings.js"

export type { Settings } from "../digitalocean.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return digitalocean.configure(input).image(modelID, input.providerOptions)
}
