import { Provider } from "../provider.js"
import { chatCompletions } from "./amazon-bedrock/mantle/chat.js"
import { messages } from "./amazon-bedrock/mantle/messages.js"
import { responses } from "./amazon-bedrock/mantle/responses.js"
import { shared } from "./amazon-bedrock/mantle/shared.js"

export type { MessagesSettings, Settings } from "./amazon-bedrock/mantle/shared.js"
export { model as chatModel } from "./amazon-bedrock/mantle/chat.js"
export { model as messagesModel } from "./amazon-bedrock/mantle/messages.js"
export { model, model as responsesModel } from "./amazon-bedrock/mantle/responses.js"

/** Every Mantle API in the default region. Each per-API entrypoint resolves `region` against its own path prefix. */
export const amazonBedrockMantle = Provider.make({
  id: shared.id,
  auth: shared.auth,
  apis: [responses, chatCompletions, messages],
})
