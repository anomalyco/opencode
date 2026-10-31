import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { Baseten } from "../baseten.js"
export { messagesModel as model } from "../baseten.js"
export type Settings = Baseten.Settings<AnthropicMessages.ProviderOptionsInput>
