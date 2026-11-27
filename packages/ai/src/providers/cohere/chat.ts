import { OpenAIChat } from "../../protocols/openai-chat.js"
import { Provider } from "../../provider.js"
import { compatibilityBaseURL, shared, type ChatOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<ChatOptionsInput>

/** Cohere's OpenAI-compatible Chat Completions API. */
export const chatCompletions = OpenAIChat.api.configure({
  // The native Chat API is cohere-chat.
  id: "cohere-chat-completions",
  baseURL: compatibilityBaseURL,
  capabilities: {
    output: { maxTokensField: "max_tokens" },
    reasoning: { field: "reasoning_content" },
    tools: { strict: false },
  },
})

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(
  Provider.make({ ...shared, apis: [chatCompletions] }),
)
