import { Config } from "effect"
import { Auth } from "../src/route.js"
import type { ProviderAuthOption } from "../src/route/auth-options.js"
import * as AmazonBedrock from "../src/providers/amazon-bedrock.js"
import * as Anthropic from "../src/providers/anthropic.js"
import * as AnthropicCompatible from "../src/providers/anthropic-compatible.js"
import * as Azure from "../src/providers/azure.js"
import { CloudflareWorkersAI } from "../src/providers/cloudflare-workers-ai.js"
import { DeepSeek } from "../src/providers/deepseek.js"
import * as Google from "../src/providers/google.js"
import * as GoogleVertex from "../src/providers/google-vertex.js"
import * as GoogleVertexChat from "../src/providers/google-vertex-chat.js"
import * as GoogleVertexMessages from "../src/providers/google-vertex-messages.js"
import * as GoogleVertexResponses from "../src/providers/google-vertex-responses.js"
import * as OpenAI from "../src/providers/openai.js"
import * as OpenRouter from "../src/providers/openrouter.js"
import * as XAI from "../src/providers/xai.js"

type BaseOptions = {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
}

type LanguageModel = {
  readonly id: string
}

declare const auth: Auth.Definition
declare const optionalAuthModel: (id: string, options?: BaseOptions & ProviderAuthOption<"optional">) => LanguageModel
declare const requiredAuthModel: (id: string, options: BaseOptions & ProviderAuthOption<"required">) => LanguageModel
const configApiKey = Config.Redacted("OPENAI_API_KEY")

optionalAuthModel("gpt-4.1-mini")
optionalAuthModel("gpt-4.1-mini", {})
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test" })
optionalAuthModel("gpt-4.1-mini", { apiKey: configApiKey })
optionalAuthModel("gpt-4.1-mini", { apiKey: false })
optionalAuthModel("gpt-4.1-mini", { auth })
optionalAuthModel("gpt-4.1-mini", { auth, baseURL: "https://gateway.example.com/v1" })
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", headers: { "x-source": "test" } })

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
optionalAuthModel("gpt-4.1-mini", { apiKey: "sk-test", auth })

requiredAuthModel("custom-model", { apiKey: "key" })
requiredAuthModel("custom-model", { apiKey: configApiKey })
requiredAuthModel("custom-model", { auth })
requiredAuthModel("custom-model", { auth, headers: { "x-tenant-id": "tenant" } })

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model")

// @ts-expect-error providers without config fallback need apiKey or auth.
requiredAuthModel("custom-model", {})

// @ts-expect-error auth is an override, so apiKey cannot be supplied with it.
requiredAuthModel("custom-model", { apiKey: "key", auth })

OpenAI.model("gpt-4.1-mini")
OpenAI.model("gpt-4.1-mini", { apiKey: "sk-test" })
OpenAI.model("gpt-4.1-mini", { apiKey: false, baseURL: "http://localhost:8080/v1" })
OpenAI.model("gpt-4.1-mini", { apiKey: "sk-test", store: false })
// @ts-expect-error provider-native options remain typed.
OpenAI.model("gpt-4.1-mini", { store: "false" })
OpenAI.openai.model("gpt-4.1-mini")
OpenAI.openai.with({}).model("gpt-4.1-mini")
OpenAI.openai.with({ apiKey: "sk-test" }).model("gpt-4.1-mini")
OpenAI.openai.with({ apiKey: configApiKey }).model("gpt-4.1-mini")
OpenAI.openai.with({ apiKey: false, baseURL: "http://localhost:8080/v1" }).model("gpt-4.1-mini")
OpenAI.openai.with({ auth: Auth.bearer("oauth-token") }).model("gpt-4.1-mini")
OpenAI.openai
  .with({ auth: Auth.headers({ authorization: "Bearer gateway" }), baseURL: "https://gateway.example.com/v1" })
  .model("gpt-4.1-mini")
OpenAI.openai.with({ options: { maxTokens: 100 }, providerOptions: { store: false } }).model("gpt-4.1-mini")
OpenAI.openai.with({ apiKey: "sk-test" }).model("gpt-4.1-mini", { api: "chat-completions" })

// @ts-expect-error provider model selection does not configure endpoints.
OpenAI.openai.model("gpt-4.1-mini", { baseURL: "https://gateway.example.com/v1" })

// @ts-expect-error provider model selection does not configure auth.
OpenAI.openai.model("gpt-4.1-mini", { auth })

// @ts-expect-error provider model selection does not configure api keys.
OpenAI.openai.model("gpt-4.1-mini", { apiKey: "sk-test" })

// @ts-expect-error apiKey only accepts string, Redacted<string>, Config<string | Redacted<string>>, or false.
OpenAI.openai.with({ apiKey: true })

// @ts-expect-error apiKey only accepts string, Redacted<string>, Config<string | Redacted<string>>, or false.
OpenAI.openai.with({ apiKey: 123 })

// @ts-expect-error provider patches reject unknown top-level options.
OpenAI.openai.with({ bogus: true })

// @ts-expect-error common generation options remain typed.
OpenAI.openai.with({ options: { maxTokens: "many" } })

Azure.model("deployment", { apiKey: "azure-key", resourceName: "resource" })
Azure.chatModel("deployment", { apiKey: "azure-key", resourceName: "resource" })
Azure.model("deployment", { baseURL: "https://gateway.example.com/azure" })
Azure.azure
  .with({ auth: Auth.header("api-key", "azure-key"), baseURL: "https://resource.openai.azure.com/openai/v1" })
  .model("deployment")

// @ts-expect-error Azure requires at least one of `resourceName` or `baseURL`.
Azure.model("deployment", { apiKey: "azure-key" })

// @ts-expect-error Azure Chat requires at least one of `resourceName` or `baseURL`.
Azure.chatModel("deployment", { apiKey: "azure-key" })

Anthropic.model("claude-haiku", { apiKey: "anthropic-key" })
Anthropic.model("claude-haiku", { apiKey: false, baseURL: "http://localhost:8080/v1" })
Anthropic.model("claude-haiku", {
  apiKey: "anthropic-key",
  thinking: { type: "enabled", budgetTokens: 1_024 },
  effort: "high",
})
// @ts-expect-error Anthropic package settings accept only one auth source.
Anthropic.model("claude-sonnet-4-6", { apiKey: "anthropic-key", authToken: "anthropic-token" })
// @ts-expect-error Enabled Anthropic thinking requires a token budget.
Anthropic.model("claude-haiku", { thinking: { type: "enabled" } })
// @ts-expect-error Anthropic thinking budgets must be numbers.
Anthropic.model("claude-haiku", { thinking: { type: "enabled", budgetTokens: "large" } })

AnthropicCompatible.model("compatible-model", {
  apiKey: "messages-key",
  baseURL: "https://messages.example.com/v1",
  provider: "example",
  thinking: { type: "disabled" },
})
// @ts-expect-error Anthropic-compatible providers require a base URL.
AnthropicCompatible.model("compatible-model", { apiKey: "messages-key" })
// @ts-expect-error Anthropic-compatible package settings accept only one auth source.
AnthropicCompatible.model("compatible-model", {
  apiKey: "messages-key",
  authToken: "messages-token",
  baseURL: "https://messages.example.com/v1",
})

Google.model("gemini-2.5-flash", { apiKey: "google-key" })
Google.model("gemini-2.5-flash", {
  apiKey: "google-key",
  thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
})
// @ts-expect-error Gemini thinking budgets must be numbers.
Google.model("gemini-2.5-flash", { thinkingConfig: { thinkingBudget: "large" } })

GoogleVertex.model("gemini-3.5-flash", { apiKey: "vertex-key", thinkingConfig: { thinkingBudget: 1_024 } })
GoogleVertex.model("gemini-3.5-flash", { accessToken: "vertex-token", project: "project" })
// @ts-expect-error Vertex keeps its ADC/express auth and does not accept apiKey: false.
GoogleVertex.model("gemini-3.5-flash", { apiKey: false })
// @ts-expect-error Vertex Gemini package settings accept only one auth source.
GoogleVertex.model("gemini-3.5-flash", { accessToken: "vertex-token", apiKey: "vertex-key", project: "project" })

GoogleVertexChat.model("deepseek-ai/deepseek-v3.2-maas", { accessToken: "vertex-token", project: "project" })
// @ts-expect-error Vertex Chat package settings do not accept API keys.
GoogleVertexChat.model("deepseek-ai/deepseek-v3.2-maas", { apiKey: "vertex-key", project: "project" })

GoogleVertexResponses.model("xai/grok-4.20-reasoning", { accessToken: "vertex-token", project: "project" })
// @ts-expect-error Vertex Responses package settings do not accept API keys.
GoogleVertexResponses.model("xai/grok-4.20-reasoning", { apiKey: "vertex-key", project: "project" })

GoogleVertexMessages.model("claude-sonnet-4-6", {
  accessToken: "vertex-token",
  project: "project",
  thinking: { type: "adaptive", display: "omitted" },
  effort: "low",
})
// @ts-expect-error Vertex Messages package settings do not accept API keys.
GoogleVertexMessages.model("claude-sonnet-4-6", { apiKey: "vertex-key", project: "project" })

AmazonBedrock.model("anthropic.claude", { apiKey: "bedrock-key" })
// @ts-expect-error Bedrock keeps its own SigV4/bearer auth and does not accept apiKey: false.
AmazonBedrock.model("anthropic.claude", { apiKey: false })

OpenRouter.model("openai/gpt-4o-mini", { apiKey: "openrouter-key" })

XAI.model("grok-4", { apiKey: "xai-key" })
XAI.xai.with({ apiKey: "xai-key" }).model("grok-4", { api: "chat-completions" })

DeepSeek.model("deepseek-chat", { apiKey: "deepseek-key" })

CloudflareWorkersAI.model("@cf/meta/llama", { accountId: "account", apiKey: "cf-key" })
