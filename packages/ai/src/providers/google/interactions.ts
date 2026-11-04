import { configure } from "../google.js"
import type { ProviderPackage } from "../../provider-package.js"
import type { GoogleInteractions } from "../../protocols/google-interactions.js"
import { toConfig } from "../settings.js"

export type Settings = ProviderPackage.Settings &
  GoogleInteractions.ProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const model: ProviderPackage.Model<Settings, GoogleInteractions.ProviderOptionsInput> = (modelID, settings) =>
  configure(toConfig(settings)).interactions(modelID)
