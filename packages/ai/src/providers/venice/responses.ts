import type { ProviderPackage } from "../../provider-package.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"
import { venice, type ResponsesSettings } from "../venice.js"
import { config } from "../venice-settings.js"

export type { ResponsesSettings as Settings } from "../venice.js"

export const model: ProviderPackage.Model<ResponsesSettings, OpenResponsesProviderOptionsInput> = (modelID, settings) =>
  venice.configure(config(settings)).responses(modelID)
