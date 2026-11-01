import { azure, type Settings } from "../azure.js"
import { config } from "../azure-settings.js"

export type { Settings } from "../azure.js"

export const model = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return azure.configure(input).image(modelID, input.providerOptions)
}
