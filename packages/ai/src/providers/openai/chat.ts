import type { ProviderPackage } from "../../provider-package.js"
import { openai, type Settings } from "../openai.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"
import { config } from "../openai-settings.js"

export type { Settings } from "../openai.js"

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  openai.configure(config(settings)).chat(modelID)
