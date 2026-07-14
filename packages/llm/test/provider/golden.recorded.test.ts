import * as Anthropic from "../../src/providers/anthropic"
import { CloudflareAIGateway, CloudflareWorkersAI } from "../../src/providers/cloudflare"
import * as Google from "../../src/providers/google"
import * as OpenAI from "../../src/providers/openai"
import * as OpenAICompatible from "../../src/providers/openai-compatible"
import * as OpenRouter from "../../src/providers/openrouter"
import * as XAI from "../../src/providers/xai"
import { describeRecordedGoldenScenarios } from "../recorded-golden"

const openAI = OpenAI.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})
const openAIChat = openAI.chat("gpt-4o-mini")
const openAIResponses = openAI.responses("gpt-5.5")
const anthropic = Anthropic.configure({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})
const anthropicHaiku = anthropic.model("claude-haiku-4-5-20251001")
const anthropicOpus = anthropic.model("claude-opus-4-7")
const google = Google.configure({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture" })
const gemini = google.model("gemini-2.5-flash")
const xai = XAI.configure({ apiKey: process.env.XAI_API_KEY ?? "fixture" })
const xaiBasic = xai.model("grok-3-mini")
const xaiFlagship = xai.model("grok-4.3")
const cloudflareAIGateway = CloudflareAIGateway.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  gatewayId:
    process.env.CLOUDFLARE_GATEWAY_ID && process.env.CLOUDFLARE_GATEWAY_ID !== process.env.CLOUDFLARE_ACCOUNT_ID
      ? process.env.CLOUDFLARE_GATEWAY_ID
      : undefined,
  gatewayApiKey: process.env.CLOUDFLARE_API_TOKEN ?? "fixture",
})
const cloudflareWorkers = CloudflareWorkersAI.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
})
const cloudflareAIGatewayWorkers = cloudflareAIGateway.model("workers-ai/@cf/meta/llama-3.1-8b-instruct")
const cloudflareAIGatewayWorkersTools = cloudflareAIGateway.model("workers-ai/@cf/openai/gpt-oss-20b")
const cloudflareWorkersAI = cloudflareWorkers.model("@cf/meta/llama-3.1-8b-instruct")
const cloudflareWorkersAITools = cloudflareWorkers.model("@cf/openai/gpt-oss-20b")
const deepseek = OpenAICompatible.deepseek
  .configure({ apiKey: process.env.DEEPSEEK_API_KEY ?? "fixture" })
  .model("deepseek-chat")
const together = OpenAICompatible.togetherai
  .configure({
    apiKey: process.env.TOGETHER_AI_API_KEY ?? "fixture",
  })
  .model("meta-llama/Llama-3.3-70B-Instruct-Turbo")
const groq = OpenAICompatible.groq
  .configure({ apiKey: process.env.GROQ_API_KEY ?? "fixture" })
  .model("llama-3.3-70b-versatile")
const openRouter = OpenRouter.configure({ apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" })
const openrouter = openRouter.model("openai/gpt-4o-mini")
const openrouterGpt55 = openRouter.model("openai/gpt-5.5")
const openrouterOpus = OpenRouter.configure({
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
}).model("anthropic/claude-opus-4.7")

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
    scenarios: ["text", "tool-call", "tool-loop", { id: "image-tool-result", maxTokens: 40 }],
  },
  {
    name: "OpenAI Responses gpt-5.5",
    prefix: "openai-responses",
    model: openAIResponses,
    requires: ["OPENAI_API_KEY"],
    tags: ["flagship"],
    scenarios: [
      { id: "text", temperature: false },
      { id: "reasoning", temperature: false },
      { id: "reasoning-continuation", temperature: false },
      { id: "tool-call", temperature: false },
      { id: "tool-loop", temperature: false },
      { id: "image-tool-result", temperature: false, maxTokens: 40 },
    ],
  },
  {
    name: "Anthropic Haiku 4.5",
    prefix: "anthropic-messages",
    model: anthropicHaiku,
    requires: ["ANTHROPIC_API_KEY"],
    options: { redact: { allowRequestHeaders: ["anthropic-version"] } },
    scenarios: ["text", "tool-call"],
  },
  {
    name: "Anthropic Opus 4.7",
    prefix: "anthropic-messages",
    model: anthropicOpus,
    requires: ["ANTHROPIC_API_KEY"],
    tags: ["flagship"],
    options: { redact: { allowRequestHeaders: ["anthropic-version"] } },
    scenarios: [
      { id: "tool-loop", temperature: false },
      { id: "image-tool-result", temperature: false, maxTokens: 40 },
    ],
  },
  {
    name: "Gemini 2.5 Flash",
    prefix: "gemini",
    model: gemini,
    requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    scenarios: [
      { id: "text", maxTokens: 80 },
      "tool-call",
      { id: "image", maxTokens: 160 },
      { id: "image-tool-result", maxTokens: 40 },
    ],
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
