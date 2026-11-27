import { gatewayModels } from "../../cache-policy.js"
import { Capabilities } from "../../capabilities.js"
import { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { Provider } from "../../provider.js"
import { api, shared, type ProviderOptionsInput, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const messages = api({
  name: "messages",
  id: "vercel-ai-gateway-messages",
  protocol: AnthropicMessages.protocol,
  kind: "messages",
  path: AnthropicMessages.PATH,
  framing: AnthropicMessages.framing,
  options: { headers: { "anthropic-version": "2023-06-01" } },
  capabilities: Capabilities.defaults<Capabilities.Messages>(),
}).configure({
  // Recorded Gateway translations for non-Claude models return thinking with empty signatures.
  models: {
    ...gatewayModels,
    "*": { ...gatewayModels["*"], reasoning: { signature: false } },
    "anthropic/*": { ...gatewayModels["anthropic/*"], reasoning: { signature: true } },
  },
})

export const model = Provider.entrypoint<Settings, ProviderOptionsInput>(Provider.make({ ...shared, apis: [messages] }))
