import type { Model, Provider } from "./models-dev"

// Built-in providers that opencode ships as first-class citizens even though
// they are not (yet) published on models.dev. Each entry is shaped exactly like
// a models.dev provider record and is merged into `ModelsDev.get()`, so it flows
// into both the v1 (packages/opencode) and v2 (packages/core catalog) provider
// systems, `/connect` auth registration, and the model picker with no per-system
// wiring. A real models.dev entry, if one ever lands, wins over the built-in.

// Eden AI (https://www.edenai.co) is an OpenAI-compatible aggregator gateway:
// one API key routes to 500+ models with smart routing and fallbacks.
// API reference: https://www.edenai.co/docs/v3/llms/chat-completions
//
// Costs and limits below are indicative list prices for the underlying models;
// Eden AI reports exact per-request cost at runtime.
const EDENAI_BASE_URL = "https://api.edenai.run/v3"

function edenaiModel(id: string, name: string, overrides: Partial<Model> = {}): Model {
  return {
    id,
    name,
    release_date: "2025-01-01",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    limit: { context: 200_000, output: 32_000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    ...overrides,
  }
}

const edenai: Provider = {
  id: "edenai",
  name: "Eden AI",
  npm: "@ai-sdk/openai-compatible",
  api: EDENAI_BASE_URL,
  env: ["EDENAI_API_KEY"],
  models: {
    // Smart Router — Eden AI picks the best model per request (quality, latency,
    // cost, live provider health). Recommended default; needs no model config.
    "@edenai": edenaiModel("@edenai", "Eden AI (Smart Router)", {
      family: "edenai",
      limit: { context: 200_000, output: 32_000 },
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    }),
    "anthropic/claude-sonnet-4-5": edenaiModel("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5", {
      family: "claude",
      release_date: "2025-09-29",
      limit: { context: 200_000, output: 64_000 },
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
    }),
    "anthropic/claude-opus-4-7": edenaiModel("anthropic/claude-opus-4-7", "Claude Opus 4.7", {
      family: "claude",
      release_date: "2025-11-24",
      limit: { context: 200_000, output: 32_000 },
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      cost: { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
    }),
    "anthropic/claude-haiku-4-5": edenaiModel("anthropic/claude-haiku-4-5", "Claude Haiku 4.5", {
      family: "claude",
      release_date: "2025-10-15",
      limit: { context: 200_000, output: 64_000 },
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
    }),
    "openai/gpt-5": edenaiModel("openai/gpt-5", "GPT-5", {
      family: "gpt",
      release_date: "2025-08-07",
      temperature: false,
      limit: { context: 400_000, output: 128_000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: { input: 1.25, output: 10 },
    }),
    "google/gemini-2.5-pro": edenaiModel("google/gemini-2.5-pro", "Gemini 2.5 Pro", {
      family: "gemini",
      release_date: "2025-06-17",
      limit: { context: 1_048_576, output: 65_536 },
      modalities: { input: ["text", "image", "pdf", "audio", "video"], output: ["text"] },
      cost: { input: 1.25, output: 10 },
    }),
  },
}

export const BuiltinProviders: Record<string, Provider> = {
  edenai,
}

// Merge the built-in providers into a models.dev catalog. Kept out of
// `ModelsDev.get()` (which stays a faithful mirror of models.dev) and applied
// wherever the provider catalog is assembled. A real models.dev entry, when
// present, always wins over the built-in of the same id.
export function withBuiltinProviders(data: Record<string, Provider>): Record<string, Provider> {
  return { ...BuiltinProviders, ...data }
}
