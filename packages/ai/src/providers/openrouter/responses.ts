import type { ProviderPackage } from "../../provider-package.js"
import { openrouter, type OpenRouterResponsesProviderOptionsInput, type ResponsesSettings } from "../openrouter.js"
import { config } from "../openrouter-settings.js"

export type { ResponsesSettings as Settings } from "../openrouter.js"

export const model: ProviderPackage.Model<ResponsesSettings, OpenRouterResponsesProviderOptionsInput> = (
  modelID,
  settings,
) => openrouter.configure(config(settings)).responses(modelID)
