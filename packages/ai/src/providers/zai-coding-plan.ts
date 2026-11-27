import { Provider } from "../provider.js"
import { chatCompletions } from "./zai-coding-plan/chat.js"
import { messages } from "./zai-coding-plan/messages.js"
import { responses } from "./zai-coding-plan/responses.js"
import {
  shared,
  type ChatOptionsInput,
  type MessagesOptionsInput,
  type ResponsesOptionsInput,
  type Settings,
} from "./zai-coding-plan/shared.js"

export type {
  ChatOptionsInput,
  MessagesOptionsInput,
  ResponsesOptionsInput,
  Settings,
} from "./zai-coding-plan/shared.js"

export const zaiCodingPlan = Provider.make({ ...shared, apis: [chatCompletions, messages, responses] })

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(zaiCodingPlan)
export const messagesModel = Provider.entrypoint<Settings<MessagesOptionsInput>, MessagesOptionsInput>(
  zaiCodingPlan,
  "messages",
)
export const responsesModel = Provider.entrypoint<Settings<ResponsesOptionsInput>, ResponsesOptionsInput>(
  zaiCodingPlan,
  "responses",
)

export * as ZAICodingPlan from "./zai-coding-plan.js"
