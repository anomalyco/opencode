import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Context, Duration, Effect, Layer, ManagedRuntime, Option, Schedule, Schema } from "effect"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Installation } from "../installation"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Flock } from "@opencode-ai/core/util/flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { withTransientReadRetry } from "@/util/effect-http-client"

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(Schema.Literals(["alpha", "beta", "deprecated"])),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))

    const source = Flag.OPENCODE_MODELS_URL || "https://models.dev"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

    let cached: Record<string, Provider> | undefined

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat?.mtime) return false
      const mtime = Option.isOption(stat.mtime) ? Number(Option.getOrElse(stat.mtime, () => new Date(0)).getTime()) : 0
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", Installation.USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    const loadFromDisk = Effect.fnUntraced(function* () {
      return yield* fs
        .readJson(Flag.OPENCODE_MODELS_PATH ?? filepath)
        .pipe(Effect.catch(() => Effect.succeed(undefined))) as Effect.Effect<
        Record<string, Provider> | undefined
      >
    })

    const loadSnapshot = Effect.promise(async () => {
      try {
        // @ts-ignore — generated at build time, may not exist in dev
        const m = await import("./models-snapshot.js")
        return m.snapshot as Record<string, Provider> | undefined
      } catch {
        return undefined
      }
    })

    const populate = Effect.fn("ModelsDev.populate")(function* () {
      const fromDisk = yield* loadFromDisk()
      if (fromDisk) return fromDisk
      const snapshot = yield* loadSnapshot
      if (snapshot) return snapshot
      if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}

      // Cross-process file lock — Flock is the right primitive (in-process
      // semaphores can't coordinate concurrent opencode CLIs writing the same cache).
      return yield* Effect.promise(() =>
        Flock.withLock(lockKey, async () => {
          const text = await Effect.runPromise(fetchApi())
          await Effect.runPromise(fs.writeWithDirs(filepath, text))
          return JSON.parse(text) as Record<string, Provider>
        }),
      )
    })

    const get = Effect.fn("ModelsDev.get")(function* () {
      if (cached) return cached
      cached = yield* populate()
      return cached
    })

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) {
        cached = undefined
        return
      }
      yield* Effect.promise(() =>
        Flock.withLock(lockKey, async () => {
          const text = await Effect.runPromise(fetchApi())
          await Effect.runPromise(fs.writeWithDirs(filepath, text))
        }),
      ).pipe(
        Effect.tapCause((cause) => Effect.logError("Failed to fetch models.dev", { cause })),
        Effect.ignore,
      )
      cached = undefined
    })

    if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.fixed("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer),
)

// Promise-style compat for callers in Promise-context (Hono routes, legacy CLI handlers).
// Uses the shared memoMap so this runtime's Service instance is shared with AppRuntime
// — Effect callers that yield ModelsDev.Service see the same cache.
const promiseRuntime = ManagedRuntime.make(defaultLayer, { memoMap })
export const get = () => promiseRuntime.runPromise(Service.use((s) => s.get()))
export const refresh = (force = false) => promiseRuntime.runPromise(Service.use((s) => s.refresh(force)))

export * as ModelsDev from "./models"
