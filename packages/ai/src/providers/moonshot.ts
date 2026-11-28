import { Provider } from "../provider.js"
import { chatCompletions } from "./moonshot/chat.js"
import { messages } from "./moonshot/messages.js"
import { responses } from "./moonshot/responses.js"
import {
  shared,
  type ChatOptionsInput,
  type MessagesOptionsInput,
  type ResponsesOptionsInput,
  type Settings,
} from "./moonshot/shared.js"

export type {
  ChatOptionsInput,
  MessagesOptionsInput,
  ReasoningEffort,
  ResponsesOptionsInput,
  Settings,
} from "./moonshot/shared.js"

export const moonshot = Provider.make({ ...shared, apis: [chatCompletions, messages, responses] })

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(moonshot)
export const messagesModel = Provider.entrypoint<Settings<MessagesOptionsInput>, MessagesOptionsInput>(
  moonshot,
  "messages",
)
export const responsesModel = Provider.entrypoint<Settings<ResponsesOptionsInput>, ResponsesOptionsInput>(
  moonshot,
  "responses",
)

export * as Moonshot from "./moonshot.js"
