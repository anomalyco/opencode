import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"
import { Flock } from "@/util/flock"
import { Hash } from "@/util/hash"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const source = url()
  const filepath = path.join(
    Global.Path.cache,
    source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
  )
  const ttl = 5 * 60 * 1000

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

  function fresh() {
    return Date.now() - Number(Filesystem.stat(filepath)?.mtimeMs ?? 0) < ttl
  }

  function skip(force: boolean) {
    return !force && fresh()
  }

  const fetchApi = async () => {
    const result = await fetch(`${url()}/api.json`, {
      headers: { "User-Agent": Installation.USER_AGENT },
      signal: AbortSignal.timeout(10000),
    })
    return { ok: result.ok, text: await result.text() }
  }

  export const Data = lazy(async () => {
    const result = await Filesystem.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).catch(() => {})
    if (result) return result
    // @ts-ignore
    const snapshot = await import("./models-snapshot.js")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
    return Flock.withLock(`models-dev:${filepath}`, async () => {
      const result = await Filesystem.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).catch(() => {})
      if (result) return result
      const result2 = await fetchApi()
      if (result2.ok) {
        await Filesystem.write(filepath, result2.text).catch((e) => {
          log.error("Failed to write models cache", { error: e })
        })
      }
      return JSON.parse(result2.text)
    })
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  export async function refresh(force = false) {
    if (skip(force)) return ModelsDev.Data.reset()
    await Flock.withLock(`models-dev:${filepath}`, async () => {
      if (skip(force)) return ModelsDev.Data.reset()
      const result = await fetchApi()
      if (!result.ok) return
      await Filesystem.write(filepath, result.text)
      ModelsDev.Data.reset()
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
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
