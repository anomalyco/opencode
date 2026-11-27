import { AnthropicMessages } from "../../../protocols/anthropic-messages.js"
import { claudeVersion } from "../../../protocols/utils/claude-model.js"
import { Provider } from "../../../provider.js"
import { baseURL, region, settings, shared, type MessagesSettings } from "./shared.js"

export type Settings = MessagesSettings

export const messages = AnthropicMessages.api.configure({
  id: "bedrock-mantle-messages",
  baseURL: baseURL(region, "/anthropic"),
  metadataKey: "mantle",
  // Mantle rejects mid-conversation `output_config` on Opus 5.0; support starts at 5.1+.
  models: (modelID) => {
    const version = claudeVersion(modelID)
    if (version?.family !== "opus" || version.major !== 5 || version.minor !== 0) return undefined
    return { reasoning: { updates: false } }
  },
})

export const model = Provider.entrypoint<MessagesSettings, AnthropicMessages.ProviderOptionsInput>(
  Provider.make({ ...shared, settings: settings("/anthropic"), apis: [messages] }),
)
