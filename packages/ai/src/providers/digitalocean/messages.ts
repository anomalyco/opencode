import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { DigitalOcean } from "../digitalocean.js"
export { messagesModel as model } from "../digitalocean.js"
export type Settings = DigitalOcean.Settings<AnthropicMessages.ProviderOptionsInput>
