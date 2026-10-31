import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { DeepSeek } from "../deepseek.js"
export { messagesModel as model } from "../deepseek.js"
export type Settings = DeepSeek.Settings<AnthropicMessages.ProviderOptionsInput>
