import type { ProviderPackage } from "../../provider-package.js"
import { Moonshot } from "../moonshot.js"
import { toConfig } from "../settings.js"

export type Settings = Moonshot.Settings<Moonshot.MessagesOptionsInput>

export const model: ProviderPackage.Model<Settings, Moonshot.MessagesOptionsInput> = (modelID, settings) =>
  Moonshot.configure(toConfig(settings)).messages(modelID)
