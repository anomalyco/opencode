import type { ProviderPackage } from "../../provider-package.js"
import { azure, type Settings } from "../azure.js"
import { config } from "../azure-settings.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"

export type { Settings } from "../azure.js"

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  azure.configure(config(settings)).chat(modelID)
