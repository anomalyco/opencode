import type { ProviderPackage } from "../../provider-package.js"
import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { azure, type MessagesSettings } from "../azure.js"
import { config } from "../azure-settings.js"

export type { MessagesSettings as Settings } from "../azure.js"

export const model: ProviderPackage.Model<MessagesSettings, AnthropicMessages.ProviderOptionsInput> = (
  modelID,
  settings,
) => azure.configure(config(settings)).messages(modelID)
