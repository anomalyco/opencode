import { OpenAIChat } from "../../protocols/openai-chat.js"
import { Provider } from "../../provider.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"
import { baseURL, guess, shared, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const chatBinding = OpenAIChat.api.at(baseURL, { guess, capabilities: { cache: { promptCacheKey: true } } })

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(
  Provider.make({ ...shared, apis: { chat: chatBinding } }),
)
