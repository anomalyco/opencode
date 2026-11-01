import type { ProviderPackage } from "../../provider-package.js"
import { meta, type Settings } from "../meta.js"
import { config } from "../meta-settings.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"

export type { Settings } from "../meta.js"

export const model: ProviderPackage.Model<Settings, OpenResponsesProviderOptionsInput> = (modelID, settings) =>
  meta.configure(config(settings)).chat(modelID)
