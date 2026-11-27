import { OpenAIChat } from "./openai-chat.js"

/**
 * OpenAI Chat as non-OpenAI hosts serve it at `/chat/completions`. Reuses the OpenAI Chat protocol end-to-end
 * with its own id, so diagnostics tell it apart from native OpenAI.
 */
export const api = OpenAIChat.api.extend({ id: "openai-compatible-chat" })

export * as OpenAICompatibleChat from "./openai-compatible-chat.js"
