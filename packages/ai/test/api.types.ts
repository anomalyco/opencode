import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { Provider } from "../src/provider.js"

const provider = Provider.make({
  id: "example",
  auth: Provider.apiKey("EXAMPLE_API_KEY"),
  apis: {
    chat: OpenAIChat.api.at("https://example.test/v1"),
    responses: OpenAIResponses.api.at("https://example.test/v1"),
  },
})

provider.model("m", { api: "chat", capabilities: { output: { maxTokensField: "max_tokens" } } })
provider.model("m", { api: "responses", capabilities: { tools: { updates: ["add"] } } })

// @ts-expect-error max-tokens field is a Chat Completions capability, not a Responses one
provider.model("m", { api: "responses", capabilities: { output: { maxTokensField: "max_tokens" } } })

// @ts-expect-error not one of the provider's APIs
provider.model("m", { api: "messages" })

OpenAIChat.api.at("https://example.test/v1", {
  // @ts-expect-error tool updates are not a Chat Completions capability
  capabilities: { tools: { updates: ["add"] } },
})
