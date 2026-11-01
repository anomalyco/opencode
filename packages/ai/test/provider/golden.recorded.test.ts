import { anthropic } from "../../src/providers/anthropic.js"
import { anthropicCompatible } from "../../src/providers/anthropic-compatible.js"
import {
  cerebras,
  cloudflareAIGateway,
  cloudflareWorkersAI,
  deepinfra,
  deepseek,
  togetherai,
} from "../../src/providers/index.js"
import { google } from "../../src/providers/google.js"
import { openai } from "../../src/providers/openai.js"
import { openaiCompatible } from "../../src/providers/openai-compatible.js"
import { openrouter } from "../../src/providers/openrouter.js"
import { xai } from "../../src/providers/xai.js"
import { describeRecordedGoldenScenarios } from "../recorded-golden.js"

const openAI = openai.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})
const openAIChat = openAI.chat("gpt-4o-mini")
const openAIResponses = openAI.responses("gpt-5.5")
const anthropicModel = anthropic.configure({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})
const anthropicHaiku = anthropicModel("claude-haiku-4-5-20251001")
const anthropicOpus = anthropicModel("claude-opus-4-7")
const minimax = anthropicCompatible.configure({
  apiKey: process.env.MINIMAX_API_KEY ?? "fixture",
  baseURL: "https://api.minimax.io/anthropic/v1",
  provider: "minimax",
})("MiniMax-M3")
const googleProvider = google.configure({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture" })
const gemini = googleProvider("gemini-2.5-flash")
const xaiProvider = xai.configure({ apiKey: process.env.XAI_API_KEY ?? "fixture" })
const xaiBasic = xaiProvider("grok-3-mini")
const xaiFlagship = xaiProvider("grok-4.3")
const cloudflareAIGatewayModel = cloudflareAIGateway.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  gatewayId:
    process.env.CLOUDFLARE_GATEWAY_ID && process.env.CLOUDFLARE_GATEWAY_ID !== process.env.CLOUDFLARE_ACCOUNT_ID
      ? process.env.CLOUDFLARE_GATEWAY_ID
      : undefined,
  gatewayApiKey: process.env.CLOUDFLARE_API_TOKEN ?? "fixture",
})
const cloudflareWorkers = cloudflareWorkersAI.configure({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "fixture-account",
  apiKey: process.env.CLOUDFLARE_API_KEY ?? "fixture",
})
const cloudflareAIGatewayWorkers = cloudflareAIGatewayModel("workers-ai/@cf/meta/llama-3.1-8b-instruct")
const cloudflareAIGatewayWorkersTools = cloudflareAIGatewayModel("workers-ai/@cf/openai/gpt-oss-20b")
const cloudflareAIGatewayClaude = cloudflareAIGatewayModel("anthropic/claude-haiku-4.5")
const cloudflareAIGatewayOpenAI = cloudflareAIGatewayModel("openai/gpt-5-nano")
const cloudflareWorkersAIModel = cloudflareWorkers("@cf/meta/llama-3.1-8b-instruct")
const cloudflareWorkersAITools = cloudflareWorkers("@cf/openai/gpt-oss-20b")
const deepseekModel = deepseek.configure({ apiKey: process.env.DEEPSEEK_API_KEY ?? "fixture" })("deepseek-chat")
const together = togetherai.configure({
  apiKey: process.env.TOGETHER_API_KEY ?? process.env.TOGETHER_AI_API_KEY ?? "fixture",
})("meta-llama/Llama-3.3-70B-Instruct-Turbo")
const cerebrasModel = cerebras.configure({ apiKey: process.env.CEREBRAS_API_KEY ?? "fixture" })("gpt-oss-120b")
// These older cassettes exercise generic Chat compatibility. Native Groq request
// shaping and reasoning are covered by groq.recorded.test.ts.
const groq = openaiCompatible.configure({
  provider: "groq",
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY ?? "fixture",
})("llama-3.3-70b-versatile")
const deepInfra = deepinfra.configure({ apiKey: process.env.DEEPINFRA_API_KEY ?? "fixture" })(
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
)
const openRouter = openrouter.configure({ apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" })
const openrouterModel = openRouter("openai/gpt-4o-mini")
const openrouterGpt55 = openRouter("openai/gpt-5.5")
const openrouterOpus = openrouter.configure({
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})("anthropic/claude-opus-4.7")

const redactCloudflareURL = (url: string) =>
  url
    .replace(/\/client\/v4\/accounts\/[^/]+\/ai\/v1\//, "/client/v4/accounts/{account}/ai/v1/")
    .replace(/\/v1\/[^/]+\/[^/]+\/(anthropic|openai)\//, "/v1/{account}/{gateway}/$1/")

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
    name: "MiniMax M3 Anthropic-compatible",
    prefix: "anthropic-compatible-messages",
    protocol: "anthropic-messages",
    model: minimax,
    requires: ["MINIMAX_API_KEY"],
    options: { redact: { allowRequestHeaders: ["anthropic-version"] } },
    scenarios: ["text", "tool-call", "tool-loop"],
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
    name: "Cloudflare AI Gateway Claude Haiku 4.5",
    prefix: "cloudflare-ai-gateway",
    model: cloudflareAIGatewayClaude,
    requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    options: { redact: { url: redactCloudflareURL, allowRequestHeaders: ["anthropic-version"] } },
    scenarios: ["text", "tool-loop"],
  },
  {
    name: "Cloudflare AI Gateway OpenAI GPT-5 Nano",
    prefix: "cloudflare-ai-gateway",
    model: cloudflareAIGatewayOpenAI,
    requires: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    options: cloudflareOptions,
    scenarios: [
      { id: "text", temperature: false, maxTokens: 2000 },
      { id: "tool-loop", temperature: false, maxTokens: 2000, timeout: 30_000 },
    ],
  },
  {
    name: "Cloudflare Workers AI Llama 3.1 8B",
    prefix: "cloudflare-workers-ai",
    model: cloudflareWorkersAIModel,
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
    model: deepseekModel,
    requires: ["DEEPSEEK_API_KEY"],
    scenarios: ["text"],
  },
  {
    name: "TogetherAI Llama 3.3 70B",
    prefix: "openai-compatible-chat",
    model: together,
    requires: ["TOGETHER_API_KEY"],
    scenarios: [
      {
        id: "text",
        cassette: "openai-compatible-chat/togetherai-streams-text",
        prompt: "Reply with exactly: Hello!",
        maxTokens: 20,
      },
      { id: "tool-call", cassette: "openai-compatible-chat/togetherai-streams-tool-call" },
    ],
  },
  {
    name: "Cerebras GPT OSS 120B",
    prefix: "cerebras-chat",
    model: cerebrasModel,
    requires: ["CEREBRAS_API_KEY"],
    scenarios: [
      { id: "text", maxTokens: 256, temperature: false },
      { id: "tool-call", maxTokens: 512, temperature: false },
      { id: "tool-loop", maxTokens: 512, temperature: false, timeout: 30_000 },
    ],
  },
  {
    name: "Groq Llama 3.3 70B",
    prefix: "openai-compatible-chat",
    model: groq,
    requires: ["GROQ_API_KEY"],
    scenarios: ["text", "tool-call", { id: "tool-loop", timeout: 30_000 }],
  },
  {
    name: "DeepInfra Llama 3.3 70B",
    prefix: "deepinfra-chat",
    model: deepInfra,
    requires: ["DEEPINFRA_API_KEY"],
    scenarios: ["text", "tool-call", { id: "tool-loop", timeout: 30_000 }],
  },
  {
    name: "OpenRouter gpt-4o-mini",
    prefix: "openai-compatible-chat",
    model: openrouterModel,
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
