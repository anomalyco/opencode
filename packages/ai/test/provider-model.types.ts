import {
  anthropic,
  google,
  groq,
  openai,
  openaiCompatible,
  opencode,
  openrouter,
  vercelAIGateway,
  xai,
} from "../src/providers/index.js"

openai("gpt-5")
openai.chat("gpt-5")
openai.image("gpt-image-1")
anthropic("claude-sonnet-4-6")
google("gemini-2.5-flash")
groq("llama-3.3-70b-versatile")
openrouter.decision("openai/gpt-5")
xai("grok-4")
opencode.decision("decision")

// @ts-expect-error OpenAI-compatible models still require a base URL.
openaiCompatible("model")
openaiCompatible("model", { baseURL: "https://example.com/v1" })

const openaiPackage = await import("../src/providers/openai.js")
const openaiChatPackage = await import("../src/providers/openai/chat.js")
const openaiImagesPackage = await import("../src/providers/openai/images.js")
const anthropicPackage = await import("../src/providers/anthropic.js")
const openrouterDecisionsPackage = await import("../src/providers/openrouter/decisions.js")
const opencodeDecisionsPackage = await import("../src/providers/opencode/decisions.js")
const openaiCompatiblePackage = await import("../src/providers/openai-compatible.js")

openaiPackage.model("gpt-5")
openaiPackage.model("gpt-5", { apiKey: "key" })
openaiChatPackage.model("gpt-5")
openaiImagesPackage.model("gpt-image-1")
anthropicPackage.model("claude-sonnet-4-6", { apiKey: "key" })
openrouterDecisionsPackage.model("openai/gpt-5")
opencodeDecisionsPackage.model("decision")
// @ts-expect-error OpenAI-compatible package models still require a base URL.
openaiCompatiblePackage.model("model")

const groqConfig: Parameters<typeof groq.configure>[0] = { apiKey: "key" }
const xaiConfig: Parameters<typeof xai.configure>[0] = { apiKey: "key" }
const gatewayConfig: Parameters<typeof vercelAIGateway.configure>[0] = { apiKey: "key" }
const compatibleConfig: Parameters<typeof openaiCompatible.configure>[0] = { baseURL: "https://example.com/v1" }

groq.configure(groqConfig)
xai.configure(xaiConfig)
vercelAIGateway.configure(gatewayConfig)
openaiCompatible.configure(compatibleConfig)
