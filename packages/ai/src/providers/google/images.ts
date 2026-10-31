import { google, type Settings } from "../google.js"
import { config } from "../google-settings.js"

export type { Settings } from "../google.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return google.configure(input).image(modelID, input.providerOptions)
}
