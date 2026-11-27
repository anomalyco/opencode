import { Api } from "../../api.js"
import { Capabilities } from "../../capabilities.js"
import { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { Provider } from "../../provider.js"
import { shared, type MessagesOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<MessagesOptionsInput>

export const messages = Api.make({
  name: "messages",
  id: "moonshot-messages",
  protocol: AnthropicMessages.protocol,
  path: AnthropicMessages.PATH,
  framing: AnthropicMessages.framing,
  capabilities: Capabilities.defaults<Capabilities.Messages>({ cache: { markers: true } }),
}).configure({
  baseURL: "https://api.moonshot.ai/anthropic/v1",
  metadataKey: "moonshot",
  capabilities: { reasoning: { signature: false }, tools: { sanitizer: "moonshot" } },
})

export const model = Provider.entrypoint<Settings, MessagesOptionsInput>(Provider.make({ ...shared, apis: [messages] }))
