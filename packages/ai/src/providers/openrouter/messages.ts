import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { OpenRouter } from "../openrouter.js"
export { messagesModel as model } from "../openrouter.js"
export type Settings = OpenRouter.Settings<AnthropicMessages.ProviderOptionsInput>
