import { Capabilities } from "../../capabilities.js"
import { OpenAIChat } from "../../protocols/openai-chat.js"
import { Provider } from "../../provider.js"
import { api, shared, type ProviderOptionsInput, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const chatCompletions = api({
  name: "chat-completions",
  id: "vercel-ai-gateway-chat",
  protocol: OpenAIChat.protocol,
  kind: "chat",
  path: OpenAIChat.PATH,
  framing: OpenAIChat.framing,
  capabilities: Capabilities.defaults<Capabilities.ChatCompletions>({ reasoning: { field: "reasoning" } }),
})

export const model = Provider.entrypoint<Settings, ProviderOptionsInput>(
  Provider.make({ ...shared, apis: [chatCompletions] }),
)
