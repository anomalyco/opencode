import type { ProviderPackage } from "../../provider-package.js"
import { Cohere } from "../cohere.js"
import { toConfig } from "../settings.js"

export type Settings = Cohere.Settings<Cohere.ChatOptionsInput>

export const model: ProviderPackage.Model<Settings, Cohere.ChatOptionsInput> = (modelID, settings) =>
  Cohere.configure(toConfig(settings)).chat(modelID)
