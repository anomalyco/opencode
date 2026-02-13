import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"

const MAMMOUTH_API_BASE = "https://api.mammouth.ai"

export namespace ModelsDev {
  const log = Log.create({ service: "models" })
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

  const ALLOWED_MODEL_FAMILIES = [
    "claude",
    "gpt",
    "o4",
    "gemini",
    "mistral",
    "deepseek",
    "grok",
    "llama",
    "kimi",
    "qwen",
  ]

  function isAllowedModel(name: string): boolean {
    const lower = name.toLowerCase()
    return ALLOWED_MODEL_FAMILIES.some((family) => lower.startsWith(family))
  }

  function capitalize(word: string): string {
    return word ? word[0].toUpperCase() + word.slice(1) : word
  }

  function humanizeModelName(name: string): string {
    const parts = name.split(/[-_]+/)
    if (parts.length === 0) return name

    const DIGITS_ONLY = /^\d+$/
    const VERSION_PART = /^\d+(\.\d+)*$/
    const isDateSuffix = (p: string) => p.length === 8 && p.startsWith("20") && DIGITS_ONLY.test(p)

    if (parts[0].toLowerCase() === "claude") {
      const filtered = parts.filter((p) => !isDateSuffix(p))
      if (DIGITS_ONLY.test(filtered[1] ?? "")) {
        const versionParts: string[] = []
        let idx = 1
        while (idx < filtered.length && DIGITS_ONLY.test(filtered[idx])) {
          versionParts.push(filtered[idx])
          idx++
        }
        const version = versionParts.join(".")
        const modelType = capitalize(filtered[idx] ?? "")
        return `Claude ${version} ${modelType}`.trim()
      }
      const modelType = capitalize(filtered[1] ?? "")
      const versionParts = filtered.slice(2).filter((p) => VERSION_PART.test(p))
      return versionParts.length > 0 ? `Claude ${modelType} ${versionParts.join(".")}` : `Claude ${modelType}`
    }

    const specialCases: Record<string, string> = { gpt: "GPT", o4: "o4" }
    return parts.map((p) => specialCases[p.toLowerCase()] ?? capitalize(p)).join(" ")
  }

  function transformApiResponse(data: any): Model[] {
    if (!data?.data || !Array.isArray(data.data)) return []

    return data.data
      .filter((item: any) => isAllowedModel(item.model_name || ""))
      .map((item: any): Model => {
        const info = item.model_info || {}
        const inputModalities: ("text" | "audio" | "image" | "video" | "pdf")[] = ["text"]
        const outputModalities: ("text" | "audio" | "image" | "video" | "pdf")[] = ["text"]

        if (info.supports_vision) inputModalities.push("image")
        if (info.supports_pdf_input) inputModalities.push("pdf")
        if (info.supports_audio_input) inputModalities.push("audio")
        if (info.supports_audio_output) outputModalities.push("audio")

        return {
          id: info.key || item.model_name,
          name: humanizeModelName(item.model_name || ""),
          family: info.litellm_provider,
          release_date: "",
          attachment: info.supports_vision || info.supports_pdf_input || false,
          reasoning: info.supports_reasoning || false,
          temperature: true,
          tool_call: info.supports_function_calling || info.supports_tool_choice || false,
          cost: {
            input: (info.input_cost_per_token || 0) * 1_000_000,
            output: (info.output_cost_per_token || 0) * 1_000_000,
            cache_read: (info.cache_read_input_token_cost || 0) * 1_000_000,
            cache_write: (info.cache_creation_input_token_cost || 0) * 1_000_000,
          },
          limit: {
            context: (info.max_input_tokens || 0) + (info.max_output_tokens || 0),
            input: info.max_input_tokens,
            output: info.max_output_tokens || 0,
          },
          modalities: {
            input: inputModalities,
            output: outputModalities,
          },
          options: {},
        }
      })
  }

  async function fetchMammouthModels(): Promise<Model[]> {
    try {
      const response = await fetch(`${MAMMOUTH_API_BASE}/public/model/info`, {
        headers: { "User-Agent": Installation.USER_AGENT },
        signal: AbortSignal.timeout(10 * 1000),
      })
      if (!response.ok) {
        log.error("Failed to fetch Mammouth models", { status: response.status })
        return []
      }
      return transformApiResponse(await response.json())
    } catch (e) {
      log.error("Error fetching Mammouth models", { error: e })
      return []
    }
  }

  const MAMMOUTH_PROVIDER: Provider = {
    id: "mammouth-ai",
    name: "Mammouth AI",
    api: `${MAMMOUTH_API_BASE}/v1`,
    npm: "@ai-sdk/openai-compatible",
    env: ["MAMMOUTH_API_KEY"],
    models: {},
  }

  export const Data = lazy(async () => {
    const file = Bun.file(Flag.OPENCODE_MODELS_PATH ?? filepath)
    const result = await file.json().catch(() => {})
    if (result) return result
    // @ts-ignore
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) {
      return { "mammouth-ai": MAMMOUTH_PROVIDER } as Record<string, Provider>
    }

    const models = await fetchMammouthModels()
    const provider: Provider = {
      ...MAMMOUTH_PROVIDER,
      models: Object.fromEntries(models.map((m) => [m.id, m])),
    }
    return { "mammouth-ai": provider } as Record<string, Provider>
    // const json = await fetch(`${url()}/api.json`).then((x) => x.text())
    // return JSON.parse(json)
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  export async function refresh() {
    try {
      const models = await fetchMammouthModels()
      if (models.length === 0) return

      const provider: Provider = {
        ...MAMMOUTH_PROVIDER,
        models: Object.fromEntries(models.map((m) => [m.id, m])),
      }
      const data = { "mammouth-ai": provider }

      await Bun.write(Bun.file(filepath), JSON.stringify(data))
      ModelsDev.Data.reset()
    } catch (e) {
      log.error("Failed to refresh models", { error: e })
    }
  }
}

if (!Flag.OPENCODE_DISABLE_MODELS_FETCH) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
