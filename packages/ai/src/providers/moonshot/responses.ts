import type { ProviderPackage } from "../../provider-package.js"
import { Moonshot } from "../moonshot.js"
import { toConfig } from "../settings.js"

export type Settings = Moonshot.Settings<Moonshot.ResponsesOptionsInput>

export const model: ProviderPackage.Model<Settings, Moonshot.ResponsesOptionsInput> = (modelID, settings) =>
  Moonshot.configure(toConfig(settings)).responses(modelID)
