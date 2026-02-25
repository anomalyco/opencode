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

  export const BUILTIN_PROVIDERS: Record<string, Provider> = {
    "bailian-coding-plan": {
      id: "bailian-coding-plan",
      env: ["BAILIAN_CODING_PLAN_API_KEY"],
      npm: "@ai-sdk/anthropic",
      api: "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1",
      name: "Model Studio Coding Plan",
      models: {
        "qwen3.5-plus": {
          id: "qwen3.5-plus",
          name: "Qwen3.5 Plus",
          family: "qwen",
          attachment: true,
          reasoning: true,
          tool_call: true,
          temperature: true,
          release_date: "2024-09-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {
            thinking: {
              type: "enabled",
              budgetTokens: 1024,
            },
          },
        },
        "qwen3-max-2026-01-23": {
          id: "qwen3-max-2026-01-23",
          name: "Qwen3 Max 2026-01-23",
          family: "qwen",
          attachment: true,
          reasoning: false,
          tool_call: true,
          temperature: true,
          release_date: "2026-01-23",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {},
        },
        "qwen3-coder-next": {
          id: "qwen3-coder-next",
          name: "Qwen3 Coder Next",
          family: "qwen",
          attachment: true,
          reasoning: false,
          tool_call: true,
          temperature: true,
          release_date: "2025-01-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {},
        },
        "qwen3-coder-plus": {
          id: "qwen3-coder-plus",
          name: "Qwen3 Coder Plus",
          family: "qwen",
          attachment: true,
          reasoning: false,
          tool_call: true,
          temperature: true,
          release_date: "2025-01-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {},
        },
        "MiniMax-M2.5": {
          id: "MiniMax-M2.5",
          name: "MiniMax M2.5",
          family: "minimax",
          attachment: true,
          reasoning: true,
          tool_call: true,
          temperature: true,
          release_date: "2025-01-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {
            thinking: {
              type: "enabled",
              budgetTokens: 1024,
            },
          },
        },
        "glm-5": {
          id: "glm-5",
          name: "GLM-5",
          family: "glm",
          attachment: true,
          reasoning: true,
          tool_call: true,
          temperature: true,
          release_date: "2025-01-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {
            thinking: {
              type: "enabled",
              budgetTokens: 1024,
            },
          },
        },
        "glm-4.7": {
          id: "glm-4.7",
          name: "GLM-4.7",
          family: "glm",
          attachment: true,
          reasoning: true,
          tool_call: true,
          temperature: true,
          release_date: "2025-01-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {
            thinking: {
              type: "enabled",
              budgetTokens: 1024,
            },
          },
        },
        "kimi-k2.5": {
          id: "kimi-k2.5",
          name: "Kimi K2.5",
          family: "kimi",
          attachment: true,
          reasoning: true,
          tool_call: true,
          temperature: true,
          release_date: "2025-01-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 131072, output: 8192 },
          options: {
            thinking: {
              type: "enabled",
              budgetTokens: 1024,
            },
          },
        },
      },
    },
  }

  export async function get() {
    const result = await Data()
    return { ...result, ...BUILTIN_PROVIDERS } as Record<string, Provider>
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
