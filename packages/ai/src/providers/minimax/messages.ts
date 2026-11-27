import { Api } from "../../api.js"
import { Capabilities } from "../../capabilities.js"
import { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { Provider } from "../../provider.js"
import { shared, type MessagesOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type { MessagesOptionsInput } from "./shared.js"
export type Settings = SharedSettings<MessagesOptionsInput>

export const messages = Api.make({
  name: "messages",
  id: "minimax-messages",
  protocol: AnthropicMessages.protocol,
  path: AnthropicMessages.PATH,
  framing: AnthropicMessages.framing,
  headers: () => ({ "anthropic-version": "2023-06-01" }),
  capabilities: Capabilities.defaults<Capabilities.Messages>({ cache: { markers: true } }),
}).configure({ baseURL: "https://api.minimax.io/anthropic/v1", capabilities: { reasoning: { signature: false } } })

export const model = Provider.entrypoint<Settings, MessagesOptionsInput>(Provider.make({ ...shared, apis: [messages] }))
