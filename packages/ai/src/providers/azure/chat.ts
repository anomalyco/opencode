import { OpenAIChat } from "../../protocols/openai-chat.js"
import { Provider } from "../../provider.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"
import { options } from "../openai/shared.js"
import { authentication, endpoint, entrypoint, id } from "./shared.js"

export type { Settings } from "./shared.js"

export const chatCompletions = OpenAIChat.api.configure({ options, capabilities: { cache: { promptCacheKey: true } } })

export const model = entrypoint<OpenAIProviderOptionsInput>(
  Provider.make({ id, auth: authentication(), apis: [chatCompletions] }),
  endpoint,
)
