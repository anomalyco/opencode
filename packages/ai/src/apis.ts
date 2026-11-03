import { AnthropicMessages } from "./protocols/anthropic-messages.js"
import { BedrockConverse } from "./protocols/bedrock-converse.js"
import { CohereChat } from "./protocols/cohere-chat.js"
import { Gemini } from "./protocols/gemini.js"
import { GoogleInteractions } from "./protocols/google-interactions.js"
import { MistralChat } from "./protocols/mistral-chat.js"
import { OpenAIChat } from "./protocols/openai-chat.js"
import { OpenAIResponses } from "./protocols/openai-responses.js"

/** The text APIs a hand-described model can speak: `Model.make({ type: "chat", api: apis.openaiChat, baseURL, ... })`. */
export const apis = {
  anthropicMessages: AnthropicMessages.route,
  bedrockConverse: BedrockConverse.route,
  cohereChat: CohereChat.route,
  gemini: Gemini.route,
  googleInteractions: GoogleInteractions.route,
  mistralChat: MistralChat.route,
  openaiChat: OpenAIChat.route,
  openaiResponses: OpenAIResponses.route,
}
