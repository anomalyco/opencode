import { ZAIChat } from "../../protocols/zai-chat.js"
import { Provider } from "../../provider.js"
import { shared, type ChatOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<ChatOptionsInput>

export const chatCompletions = ZAIChat.api.configure({
  id: "zai-coding-chat",
  baseURL: "https://api.z.ai/api/coding/paas/v4",
  metadataKey: "zai",
})

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(
  Provider.make({ ...shared, apis: [chatCompletions] }),
)
