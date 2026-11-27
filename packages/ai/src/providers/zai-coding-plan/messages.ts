import { ZAIMessages } from "../../protocols/zai-messages.js"
import { Provider } from "../../provider.js"
import { shared, type MessagesOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<MessagesOptionsInput>

export const messages = ZAIMessages.api.configure({
  baseURL: "https://api.z.ai/api/anthropic/v1",
  metadataKey: "zai",
  capabilities: { reasoning: { signature: false } },
})

export const model = Provider.entrypoint<Settings, MessagesOptionsInput>(Provider.make({ ...shared, apis: [messages] }))
