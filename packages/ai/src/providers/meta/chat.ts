import { OpenAIChat } from "../../protocols/openai-chat.js"
import { Provider } from "../../provider.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"
import { shared, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const chatCompletions = OpenAIChat.api
  .extend({ id: "meta-chat" })
  .configure({ capabilities: { cache: { promptCacheKey: true }, output: { maxTokensField: "max_completion_tokens" } } })

export const model = Provider.entrypoint<Settings, OpenResponsesProviderOptionsInput>(
  Provider.make({ ...shared, apis: [chatCompletions] }),
)
