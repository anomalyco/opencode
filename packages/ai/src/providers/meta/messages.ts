import type { ProviderPackage } from "../../provider-package.js"
import { meta, type MessagesOptionsInput, type Settings } from "../meta.js"
import { config } from "../meta-settings.js"

export type { Settings } from "../meta.js"

export const model: ProviderPackage.Model<Settings, MessagesOptionsInput> = (modelID, settings) =>
  meta.configure(config(settings)).messages(modelID)
