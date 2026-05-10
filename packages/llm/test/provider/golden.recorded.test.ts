import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import * as Gemini from "../../src/protocols/gemini"
import * as OpenAIChat from "../../src/protocols/openai-chat"
import * as OpenAIResponses from "../../src/protocols/openai-responses"
import * as Cloudflare from "../../src/providers/cloudflare"
import * as OpenAI from "../../src/providers/openai"
import * as OpenAICompatible from "../../src/providers/openai-compatible"
import * as OpenRouter from "../../src/providers/openrouter"
import * as XAI from "../../src/providers/xai"
import { describeRecordedGoldenScenarios } from "../recorded-golden"

const openAIChat = OpenAIChat.model({ id: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY ?? "fixture" })
const openAIResponses = OpenAIResponses.model({ id: "gpt-5.5", apiKey: process.env.OPENAI_API_KEY ?? "fixture" })
const openAIResponsesWebSocket = OpenAI.responsesWebSocket("gpt-4.1-mini", {
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})
const anthropicHaiku = AnthropicMessages.model({
  id: "claude-haiku-4-5-20251001",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})
const anthropicOpus = AnthropicMessages.model({
  id: "claude-opus-4-7",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})
const gemini = Gemini.model({ id: "gemini-2.5-flash", apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture" })
const xaiBasic = XAI.model("grok-3-mini", { apiKey: process.env.XAI_API_KEY ?? "fixture" })
const xaiFlagship = XAI.model("grok-4.3", { apiKey: process.env.XAI_API_KEY ?? "fixture" })
const cloudflareAIGatewayWorkers = Cloudflare.aiGateway("workers-ai/@cf/meta/llama-3.1-8b-instruct", {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  gatewayId:
    process.env.CLOUDFLARE_GATEWAY_ID && process.env.CLOUDFLARE_GATEWAY_ID !== process.env.CLOUDFLARE_ACCOUNT_ID
      ? process.env.CLOUDFLARE_GATEWAY_ID
      : undefined,
  gatewayApiKey: process.env.CLOUDFLARE_API_TOKEN ?? "fixture",
})
const cloudflareAIGatewayWorkersTools = Cloudflare.aiGateway("workers-ai/@cf/openai/gpt-oss-20b", {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  gatewayId:
    process.env.CLOUDFLARE_GATEWAY_ID && process.env.CLOUDFLARE_GATEWAY_ID !== process.env.CLOUDFLARE_ACCOUNT_ID
      ? process.env.CLOUDFLARE_GATEWAY_ID
      : undefined,
  gatewayApiKey: process.env.CLOUDFLARE_API_TOKEN ?? "fixture",
})
const cloudflareWorkersAI = Cloudflare.workersAI("@cf/meta/llama-3.1-8b-instruct", {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
})
const cloudflareWorkersAITools = Cloudflare.workersAI("@cf/openai/gpt-oss-20b", {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
})
const deepseek = OpenAICompatible.deepseek.model("deepseek-chat", { apiKey: process.env.DEEPSEEK_API_KEY ?? "fixture" })
const together = OpenAICompatible.togetherai.model("meta-llama/Llama-3.3-70B-Instruct-Turbo", {
  apiKey: process.env.TOGETHER_AI_API_KEY ?? "fixture",
})
const groq = OpenAICompatible.groq.model("llama-3.3-70b-versatile", { apiKey: process.env.GROQ_API_KEY ?? "fixture" })
const openrouter = OpenRouter.model("openai/gpt-4o-mini", { apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" })
const openrouterGpt55 = OpenRouter.model("openai/gpt-5.5", { apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" })
const openrouterOpus = OpenRouter.model("anthropic/claude-opus-4.7", {
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})

const redactCloudflareURL = (url: string) =>
  url
    .replace(/\/client\/v4\/accounts\/[^/]+\/ai\/v1\//, "/client/v4/accounts/{account}/ai/v1/")
    .replace(/\/v1\/[^/]+\/[^/]+\/compat\//, "/v1/{account}/{gateway}/compat/")

const cloudflareOptions = {
  redact: { url: redactCloudflareURL },
}

describeRecordedGoldenScenarios([
  {
    name: "OpenAI Chat gpt-4o-mini",
    prefix: "openai-chat",
    model: openAIChat,
    requires: ["OPENAI_API_KEY"],
    scenarios: ["text", "tool-call", "tool-loop"],
  },
  {
    name: "OpenAI Responses gpt-5.5",
    prefix: "openai-responses",
    model: openAIResponses,
    requires: ["OPENAI_API_KEY"],
    tags: ["flagship"],
    scenarios: [
      { id: "text", temperature: false },
      { id: "tool-call", temperature: false },
      { id: "tool-loop", temperature: false },
    ],
  },
  {
    name: "OpenAI Responses WebSocket gpt-4.1-mini",
    prefix: "openai-responses-websocket",
    model: openAIResponsesWebSocket,
    transport: "websocket",
    requires: ["OPENAI_API_KEY"],
    scenarios: ["tool-loop"],
  },
  {
    name: "Anthropic Haiku 4.5",
    prefix: "anthropic-messages",
    model: anthropicHaiku,
    requires: ["ANTHROPIC_API_KEY"],
    options: { requestHeaders: ["content-type", "anthropic-version"] },
    scenarios: ["text", "tool-call"],
  },
  {
    name: "Anthropic Opus 4.7",
    prefix: "anthropic-messages",
    model: anthropicOpus,
    requires: ["ANTHROPIC_API_KEY"],
    tags: ["flagship"],
    options: { requestHeaders: ["content-type", "anthropic-version"] },
    scenarios: [{ id: "tool-loop", temperature: false }],
  },
  {
    name: "Gemini 2.5 Flash",
    prefix: "gemini",
    model: gemini,
    requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    scenarios: [{ id: "text", maxTokens: 80 }, "tool-call"],
  },
  {
    name: "xAI Grok 3 Mini",
    prefix: "xai",
    model: xaiBasic,
    requires: ["XAI_API_KEY"],
    scenarios: ["text", "tool-call"],
  },
  {
    name: "xAI Grok 4.3",
    prefix: "xai",
    model: xaiFlagship,
    requires: ["XAI_API_KEY"],
    tags: ["flagship"],
    scenarios: [{ id: "tool-loop", timeout: 30_000 }],
  },
  {
    name: "Cloudflare AI Gateway Workers AI Llama 3.1 8B",
    prefix: "cloudflare-ai-gateway",
    model: cloudflareAIGatewayWorkers,
    requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    options: cloudflareOptions,
    scenarios: ["text"],
  },
  {
    name: "Cloudflare AI Gateway Workers AI GPT OSS 20B Tools",
    prefix: "cloudflare-ai-gateway",
    model: cloudflareAIGatewayWorkersTools,
    requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    options: cloudflareOptions,
    scenarios: [{ id: "tool-call", maxTokens: 120 }],
  },
  {
    name: "Cloudflare Workers AI Llama 3.1 8B",
    prefix: "cloudflare-workers-ai",
    model: cloudflareWorkersAI,
    requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
    options: cloudflareOptions,
    scenarios: ["text"],
  },
  {
    name: "Cloudflare Workers AI GPT OSS 20B Tools",
    prefix: "cloudflare-workers-ai",
    model: cloudflareWorkersAITools,
    requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
    options: cloudflareOptions,
    scenarios: [{ id: "tool-call", maxTokens: 120 }],
  },
  {
    name: "DeepSeek Chat",
    prefix: "openai-compatible-chat",
    model: deepseek,
    requires: ["DEEPSEEK_API_KEY"],
    scenarios: ["text"],
  },
  {
    name: "TogetherAI Llama 3.3 70B",
    prefix: "openai-compatible-chat",
    model: together,
    requires: ["TOGETHER_AI_API_KEY"],
    scenarios: ["text", "tool-call"],
  },
  {
    name: "Groq Llama 3.3 70B",
    prefix: "openai-compatible-chat",
    model: groq,
    requires: ["GROQ_API_KEY"],
    scenarios: ["text", "tool-call", { id: "tool-loop", timeout: 30_000 }],
  },
  {
    name: "OpenRouter gpt-4o-mini",
    prefix: "openai-compatible-chat",
    model: openrouter,
    requires: ["OPENROUTER_API_KEY"],
    scenarios: ["text", "tool-call", "tool-loop"],
  },
  {
    name: "OpenRouter gpt-5.5",
    prefix: "openai-compatible-chat",
    model: openrouterGpt55,
    requires: ["OPENROUTER_API_KEY"],
    tags: ["flagship"],
    scenarios: ["tool-loop"],
  },
  {
    name: "OpenRouter Claude Opus 4.7",
    prefix: "openai-compatible-chat",
    model: openrouterOpus,
    requires: ["OPENROUTER_API_KEY"],
    tags: ["flagship"],
    scenarios: ["tool-loop"],
  },
])
