import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { Fireworks } from "../fireworks.js"
export { messagesModel as model } from "../fireworks.js"
export type Settings = Fireworks.Settings<AnthropicMessages.ProviderOptionsInput>
