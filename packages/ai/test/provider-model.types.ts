import {
  Anthropic,
  Google,
  Groq,
  OpenAI,
  OpenAICompatible,
  OpenCode,
  OpenRouter,
  VercelAIGateway,
  XAI,
} from "../src/providers/index.js"

OpenAI.model("gpt-5")
OpenAI.chatModel("gpt-5")
OpenAI.imageModel("gpt-image-1")
Anthropic.model("claude-sonnet-4-6")
Google.model("gemini-2.5-flash")
Groq.model("llama-3.3-70b-versatile")
OpenRouter.decisionModel("openai/gpt-5")
XAI.model("grok-4")
OpenCode.decisionModel("decision")

OpenAI.model("gpt-5", { apiKey: "key" })
Anthropic.model("claude-sonnet-4-6", { apiKey: "key" })

// @ts-expect-error OpenAI-compatible models still require a base URL.
OpenAICompatible.model("model")

Groq.groq.with({ apiKey: "key" }).model("llama-3.3-70b-versatile")
XAI.xai.with({ apiKey: "key" }).model("grok-4")
VercelAIGateway.vercelAIGateway.with({ apiKey: "key" }).model("openai/gpt-5")
OpenAICompatible.openAICompatible.with({ baseURL: "https://example.com/v1" }).model("model")
