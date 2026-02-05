import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  // Built-in provider entries that should always be available in OpenCode's provider directory
  // (even if models.dev doesn't list them).
  const BUILTIN_PROVIDERS: Record<string, Provider> = {
    llmgateway: {
      id: "llmgateway",
      name: "LLM Gateway",
      api: "https://api.llmgateway.io/v1",
      npm: "@llmgateway/ai-sdk-provider",
      env: ["LLM_GATEWAY_API_KEY", "LLMGATEWAY_API_KEY"],
      models: {
        // Claude models
        "claude-sonnet-4-5": {
          id: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          family: "claude",
          release_date: "2025-09-29",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: true,
          cost: { input: 3.0, output: 15.0, cache_read: 0.3 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 200000, output: 64000 },
          options: {},
        },
        "claude-opus-4-5-20251101": {
          id: "claude-opus-4-5-20251101",
          name: "Claude Opus 4.5",
          family: "claude",
          release_date: "2025-11-01",
          attachment: true,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: true,
          cost: { input: 15.0, output: 75.0, cache_read: 1.5 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 200000, output: 32000 },
          options: {},
        },
        "claude-3-5-sonnet": {
          id: "claude-3-5-sonnet",
          name: "Claude 3.5 Sonnet",
          family: "claude",
          release_date: "2024-06-20",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 3.0, output: 15.0, cache_read: 0.3 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 200000, output: 8192 },
          options: {},
        },
        "claude-3-7-sonnet": {
          id: "claude-3-7-sonnet",
          name: "Claude 3.7 Sonnet",
          family: "claude",
          release_date: "2025-02-19",
          attachment: true,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: true,
          cost: { input: 3.0, output: 15.0, cache_read: 0.3 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 200000, output: 128000 },
          options: {},
        },
        // GPT models
        "gpt-4o": {
          id: "gpt-4o",
          name: "GPT-4o",
          family: "gpt",
          release_date: "2024-05-13",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 2.5, output: 10.0, cache_read: 1.25 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 128000, output: 16384 },
          options: {},
        },
        "gpt-4o-mini": {
          id: "gpt-4o-mini",
          name: "GPT-4o Mini",
          family: "gpt",
          release_date: "2024-07-18",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.15, output: 0.6, cache_read: 0.075 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 128000, output: 16384 },
          options: {},
        },
        "gpt-4.1": {
          id: "gpt-4.1",
          name: "GPT-4.1",
          family: "gpt",
          release_date: "2025-04-14",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 2.0, output: 8.0, cache_read: 0.5 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 1047576, output: 32768 },
          options: {},
        },
        "o3-mini": {
          id: "o3-mini",
          name: "o3-mini",
          family: "gpt",
          release_date: "2025-01-31",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: { field: "reasoning_content" },
          cost: { input: 1.1, output: 4.4 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 200000, output: 100000 },
          options: {},
        },
        "o3": {
          id: "o3",
          name: "o3",
          family: "gpt",
          release_date: "2025-04-16",
          attachment: true,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: { field: "reasoning_content" },
          cost: { input: 10.0, output: 40.0 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 200000, output: 100000 },
          options: {},
        },
        // Gemini models
        "gemini-2.5-pro": {
          id: "gemini-2.5-pro",
          name: "Gemini 2.5 Pro",
          family: "gemini",
          release_date: "2025-03-25",
          attachment: true,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: true,
          cost: { input: 1.25, output: 10.0 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 1000000, output: 16384 },
          options: {},
        },
        "gemini-2.5-flash": {
          id: "gemini-2.5-flash",
          name: "Gemini 2.5 Flash",
          family: "gemini",
          release_date: "2025-04-17",
          attachment: true,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: true,
          cost: { input: 0.15, output: 0.6, cache_read: 0.0375 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 1000000, output: 65536 },
          options: {},
        },
        "gemini-2.0-flash": {
          id: "gemini-2.0-flash",
          name: "Gemini 2.0 Flash",
          family: "gemini",
          release_date: "2025-02-05",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.1, output: 0.4, cache_read: 0.025 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 1000000, output: 8192 },
          options: {},
        },
        // Grok models
        "grok-3": {
          id: "grok-3",
          name: "Grok 3",
          family: "grok",
          release_date: "2025-02-18",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 3.0, output: 15.0 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 131072, output: 131072 },
          options: {},
        },
        "grok-3-mini": {
          id: "grok-3-mini",
          name: "Grok 3 Mini",
          family: "grok",
          release_date: "2025-02-18",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: { field: "reasoning_content" },
          cost: { input: 0.3, output: 0.5 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 131072, output: 131072 },
          options: {},
        },
        "grok-4": {
          id: "grok-4",
          name: "Grok 4",
          family: "grok",
          release_date: "2025-07-09",
          attachment: true,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: { field: "reasoning_content" },
          cost: { input: 3.0, output: 15.0 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 262144, output: 131072 },
          options: {},
        },
        // DeepSeek models
        "deepseek-v3": {
          id: "deepseek-v3",
          name: "DeepSeek V3",
          family: "deepseek",
          release_date: "2024-12-25",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.27, output: 1.1, cache_read: 0.07 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 65536, output: 8192 },
          options: {},
        },
        "deepseek-r1-0528": {
          id: "deepseek-r1-0528",
          name: "DeepSeek R1",
          family: "deepseek",
          release_date: "2025-05-28",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: false,
          interleaved: { field: "reasoning_content" },
          cost: { input: 0.55, output: 2.19, cache_read: 0.14 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 65536, output: 32768 },
          options: {},
        },
        // Llama models
        "llama-4-scout": {
          id: "llama-4-scout",
          name: "Llama 4 Scout",
          family: "llama",
          release_date: "2025-04-05",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.17, output: 0.3 },
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 512000, output: 250000 },
          options: {},
        },
        "llama-3.3-70b-instruct": {
          id: "llama-3.3-70b-instruct",
          name: "Llama 3.3 70B Instruct",
          family: "llama",
          release_date: "2024-12-06",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.12, output: 0.3 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 131072, output: 16384 },
          options: {},
        },
        // Qwen models
        "qwen3-max": {
          id: "qwen3-max",
          name: "Qwen3 Max",
          family: "qwen",
          release_date: "2026-01-23",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          interleaved: true,
          cost: { input: 1.6, output: 6.4, cache_read: 0.16 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 131072, output: 16384 },
          options: {},
        },
        "qwen-plus": {
          id: "qwen-plus",
          name: "Qwen Plus",
          family: "qwen",
          release_date: "2024-09-19",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.8, output: 2.0, cache_read: 0.2 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 131072, output: 16384 },
          options: {},
        },
        // GLM models
        "glm-4.7": {
          id: "glm-4.7",
          name: "GLM-4.7",
          family: "glm",
          release_date: "2025-12-22",
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          interleaved: true,
          cost: { input: 0.5, output: 0.5 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 200000, output: 128000 },
          options: {},
        },
        "glm-4.5": {
          id: "glm-4.5",
          name: "GLM-4.5",
          family: "glm",
          release_date: "2025-10-13",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 4.0, output: 4.0 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 128000, output: 16384 },
          options: {},
        },
        // Mistral models
        "mistral-large-latest": {
          id: "mistral-large-latest",
          name: "Mistral Large",
          family: "mistral",
          release_date: "2024-02-26",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 2.0, output: 6.0 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 131072, output: 131072 },
          options: {},
        },
        // Kimi models
        "kimi-k2": {
          id: "kimi-k2",
          name: "Kimi K2",
          family: "kimi",
          release_date: "2025-07-11",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.14, output: 0.28 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 131072, output: 16384 },
          options: {},
        },
        // Sonar models
        "sonar-pro": {
          id: "sonar-pro",
          name: "Sonar Pro",
          family: "sonar",
          release_date: "2025-02-01",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: false,
          cost: { input: 3.0, output: 15.0 },
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 200000, output: 8000 },
          options: {},
        },
      },
    },
  }

  function overlayBuiltins(providers: Record<string, Provider>) {
    for (const [id, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      if (!providers[id]) providers[id] = provider
    }
    return providers
  }

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function url() {
    return Flag.OPENCODE_MODELS_URL || "https://models.dev"
  }

  export const Data = lazy(async () => {
    const result = await Filesystem.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).catch(() => {})
    if (result) return result
    // @ts-ignore
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
    const json = await fetch(`${url()}/api.json`).then((x) => x.text())
    return JSON.parse(json)
  })

  export async function get() {
    const result = await Data()
    return overlayBuiltins(result as Record<string, Provider>)
  }

  export async function refresh() {
    const result = await fetch(`${url()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) {
      await Filesystem.write(filepath, await result.text())
      ModelsDev.Data.reset()
    }
  }
}

if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
