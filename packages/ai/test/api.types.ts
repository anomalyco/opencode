import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { Provider } from "../src/provider.js"

const provider = Provider.make({
  id: "example",
  baseURL: "https://example.test/v1",
  auth: Provider.apiKey("EXAMPLE_API_KEY"),
  apis: [OpenAIChat.api, OpenAIResponses.api],
})

provider.model("m", { api: "chat-completions", capabilities: { output: { maxTokensField: "max_tokens" } } })
provider.model("m", { api: "responses", capabilities: { tools: { updates: ["add"] } } })

// @ts-expect-error max-tokens field is a Chat Completions capability, not a Responses one
provider.model("m", { api: "responses", capabilities: { output: { maxTokensField: "max_tokens" } } })

// @ts-expect-error not one of the provider's APIs
provider.model("m", { api: "messages" })

// @ts-expect-error tool updates are not a Chat Completions capability
OpenAIChat.api.configure({ capabilities: { tools: { updates: ["add"] } } })

// @ts-expect-error an API listed twice
Provider.make({ id: "twice", auth: Provider.keyless, apis: [OpenAIChat.api, OpenAIChat.api] })
