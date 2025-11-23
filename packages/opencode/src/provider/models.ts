import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { data } from "./models-macro" with { type: "macro" }
import { Installation } from "../installation"

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z
    .object({
      id: z.string(),
      name: z.string(),
      release_date: z.string(),
      attachment: z.boolean(),
      reasoning: z.boolean(),
      temperature: z.boolean(),
      tool_call: z.boolean(),
      cost: z.object({
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
      }),
      limit: z.object({
        context: z.number(),
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
      provider: z.object({ npm: z.string() }).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Provider = z
    .object({
      api: z.string().optional(),
      name: z.string(),
      env: z.array(z.string()),
      id: z.string(),
      npm: z.string().optional(),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })

  export type Provider = z.infer<typeof Provider>

  export async function get() {
    if (process.env.OPENCODE_OFFLINE === "1") {
      const cached = await Bun.file(filepath)
        .json()
        .catch(() => undefined)
      if (cached) return cached as Record<string, Provider>
      const fallbackRaw = await Promise.resolve(data()).catch(() => "{}")
      const fallback = typeof fallbackRaw === "string" ? fallbackRaw : "{}"
      const parsed = JSON.parse(fallback ?? "{}") as Record<string, Provider>
      if (Object.keys(parsed).length > 0) return parsed
      const offlineModel: Model = {
        id: "offline-model",
        name: "Offline Model",
        release_date: new Date().toISOString(),
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: false,
        cost: {
          input: 0,
          output: 0,
        },
        limit: {
          context: 1024,
          output: 256,
        },
        options: {},
      }
      return {
        offline: {
          api: "",
          name: "offline",
          env: [],
          id: "offline",
          models: {
            [offlineModel.id]: offlineModel,
          },
        },
      }
    }
    refresh()
    const file = Bun.file(filepath)
    const result = await file.json().catch(() => {})
    if (result) return result as Record<string, Provider>
    const jsonRaw = await Promise.resolve(data()).catch(() => "{}")
    const json = typeof jsonRaw === "string" ? jsonRaw : "{}"
    return JSON.parse(json) as Record<string, Provider>
  }

  export async function refresh() {
    if (process.env.OPENCODE_OFFLINE === "1") return
    const file = Bun.file(filepath)
    log.info("refreshing", {
      file,
    })
    const result = await fetch("https://models.dev/api.json", {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((error) => {
      log.error("Failed to fetch models.dev", {
        error,
      })
      return undefined
    })
    if (!result) return
    if (!result.ok) return
    await Bun.write(file, await result.text())
  }
}

setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref()
