import { baseten, type Settings } from "../baseten.js"
import { config } from "../baseten-settings.js"

export type { Settings } from "../baseten.js"

export const model = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return baseten.configure(input).decision(modelID, input.providerOptions)
}
