import type { ProviderPackage } from "../../provider-package.js"
import { ZAIChat } from "../../protocols/zai-chat.js"
import { Provider } from "../../provider.js"

export type ChatOptionsInput = ZAIChat.OptionsInput

export type Settings = ProviderPackage.Settings &
  ChatOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const zai = Provider.make({
  id: "zai",
  baseURL: "https://api.z.ai/api/paas/v4",
  auth: Provider.apiKey("ZAI_API_KEY"),
  apis: [ZAIChat.api],
})

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(zai)
