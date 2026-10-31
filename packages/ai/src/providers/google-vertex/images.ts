import { googleVertex, type Settings } from "../google-vertex.js"
import { config } from "../google-vertex-settings.js"

export type { Settings } from "../google-vertex.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return googleVertex.configure(input).image(modelID, input.providerOptions)
}
