import os from "os"
import path from "path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { ToolFile, ToolSignature } from "./types"

export class ToolRuntimeError extends Schema.TaggedErrorClass<ToolRuntimeError>()("ToolRuntimeError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

interface ToolInstance {
  fn: (args: any) => any
  signature: ToolSignature
  lastUsedAt: number
}

export interface ScoredSignature extends ToolSignature {
  score: number
}

export interface ToolRuntimeInterface {
  register(name: string, filePath: string): Effect.Effect<ToolSignature, ToolRuntimeError>
  execute(name: string, args: unknown): Effect.Effect<unknown, ToolRuntimeError>
  unregister(name: string): Effect.Effect<void, ToolRuntimeError>
  reload(name: string, filePath: string): Effect.Effect<ToolSignature, ToolRuntimeError>
  isRegistered(name: string): Effect.Effect<boolean, never>

  activate(name: string): Effect.Effect<ToolSignature, ToolRuntimeError>
  deactivate(name: string): Effect.Effect<void, ToolRuntimeError>
  isActive(name: string): Effect.Effect<boolean, never>

  list(): Effect.Effect<ToolSignature[], ToolRuntimeError>
  listCatalog(): Effect.Effect<ToolSignature[], ToolRuntimeError>

  searchCatalog(query: string): Effect.Effect<ScoredSignature[], ToolRuntimeError>

  setMaxActive(n: number): Effect.Effect<void, never>
}

const ACTIVE_TTL_MS = 5 * 60 * 1000

const buildAndImport = Effect.fn("ToolRuntime.buildAndImport")(function* (name: string, filePath: string) {
  const outdir = path.join(os.tmpdir(), "opencode-tools", `${name}-${Date.now()}`)

  const result = yield* Effect.tryPromise({
    try: async () => {
      const out = await Bun.build({
        entrypoints: [filePath],
        outdir,
        format: "esm",
      })
      if (out.logs.length > 0) {
        throw new AggregateError(out.logs, out.logs.map((l) => l.message).join("; "))
      }
      return out
    },
    catch: (cause) => new ToolRuntimeError({ message: `Failed to build tool "${name}": ${cause}`, cause }),
  })

  const outFile = result.outputs[0]
  if (!outFile) {
    return yield* new ToolRuntimeError({ message: `Build produced no output for tool "${name}"` })
  }

  const mod = yield* Effect.tryPromise({
    try: () => import(outFile.path),
    catch: (cause) => new ToolRuntimeError({ message: `Failed to load built tool "${name}"`, cause }),
  })

  const toolFile = mod as { tool?: ToolFile; default?: (args: any) => any }
  if (!toolFile.tool) {
    return yield* new ToolRuntimeError({ message: `Tool "${name}" missing 'tool' export` })
  }
  if (typeof mod.default !== "function") {
    return yield* new ToolRuntimeError({ message: `Tool "${name}" missing default export function` })
  }

  const signature: ToolSignature = {
    name: toolFile.tool.name,
    description: toolFile.tool.description,
    input: toolFile.tool.schema.input,
    output: toolFile.tool.schema.output,
  }

  return { fn: mod.default as (args: any) => any, signature, lastUsedAt: 0 }
})

const touchUsage = (order: string[], name: string): void => {
  const idx = order.indexOf(name)
  if (idx >= 0) order.splice(idx, 1)
  order.push(name)
}

const evictLRU = (active: Map<string, ToolInstance>, usageOrder: string[]): string | undefined => {
  while (usageOrder.length > 0) {
    const oldest = usageOrder.shift()!
    if (active.has(oldest)) {
      active.delete(oldest)
      return oldest
    }
  }
}

const evictExpired = (active: Map<string, ToolInstance>, usageOrder: string[]): void => {
  const now = Date.now()
  const expired: string[] = []
  for (const [name, instance] of active) {
    if (now - instance.lastUsedAt > ACTIVE_TTL_MS) expired.push(name)
  }
  for (const name of expired) {
    active.delete(name)
    const idx = usageOrder.indexOf(name)
    if (idx >= 0) usageOrder.splice(idx, 1)
  }
}

const ensureActive = (
  name: string,
  catalog: Map<string, ToolInstance>,
  active: Map<string, ToolInstance>,
  usageOrder: string[],
  maxActive: number,
): ToolInstance | null => {
  const existing = active.get(name)
  if (existing) {
    touchUsage(usageOrder, name)
    existing.lastUsedAt = Date.now()
    return existing
  }

  const instance = catalog.get(name)
  if (!instance) return null

  if (active.size >= maxActive) {
    evictLRU(active, usageOrder)
  }

  active.set(name, instance)
  instance.lastUsedAt = Date.now()
  touchUsage(usageOrder, name)
  return instance
}

const DEFAULT_MAX_ACTIVE = 20

export class ToolRuntime extends Context.Service<ToolRuntime, ToolRuntimeInterface>()(
  "@opencode-ai/database/ToolRuntime",
) {
  static layer = Layer.effect(
    ToolRuntime,
    Effect.sync(() => {
      const catalog = new Map<string, ToolInstance>()
      const active = new Map<string, ToolInstance>()
      const usageOrder: string[] = []
      let maxActive = DEFAULT_MAX_ACTIVE

      return ToolRuntime.of({
        register: Effect.fn("ToolRuntime.register")(function* (name, filePath) {
          const instance = yield* buildAndImport(name, filePath)
          catalog.set(name, instance)
          return instance.signature
        }),

        execute: Effect.fn("ToolRuntime.execute")(function* (name, args) {
          const tool = ensureActive(name, catalog, active, usageOrder, maxActive)
          if (!tool) {
            return yield* new ToolRuntimeError({
              message: `Tool "${name}" not found. Register it first.`,
            })
          }
          return yield* Effect.try({
            try: () => tool.fn(args),
            catch: (cause) => new ToolRuntimeError({ message: `Tool "${name}" execution failed`, cause }),
          })
        }),

        unregister: Effect.fn("ToolRuntime.unregister")(function* (name) {
          catalog.delete(name)
          active.delete(name)
          const idx = usageOrder.indexOf(name)
          if (idx >= 0) usageOrder.splice(idx, 1)
        }),

        reload: Effect.fn("ToolRuntime.reload")(function* (name, filePath) {
          catalog.delete(name)
          active.delete(name)
          const idx = usageOrder.indexOf(name)
          if (idx >= 0) usageOrder.splice(idx, 1)
          const instance = yield* buildAndImport(name, filePath)
          catalog.set(name, instance)
          return instance.signature
        }),

        isRegistered: Effect.fn("ToolRuntime.isRegistered")(function* (name) {
          return catalog.has(name)
        }),

        activate: Effect.fn("ToolRuntime.activate")(function* (name) {
          const instance = catalog.get(name)
          if (!instance) {
            return yield* new ToolRuntimeError({ message: `Tool "${name}" not found in catalog` })
          }

          if (active.has(name)) {
            touchUsage(usageOrder, name)
            instance.lastUsedAt = Date.now()
            return instance.signature
          }

          if (active.size >= maxActive) {
            evictLRU(active, usageOrder)
          }

          active.set(name, instance)
          instance.lastUsedAt = Date.now()
          touchUsage(usageOrder, name)
          return instance.signature
        }),

        deactivate: Effect.fn("ToolRuntime.deactivate")(function* (name) {
          active.delete(name)
          const idx = usageOrder.indexOf(name)
          if (idx >= 0) usageOrder.splice(idx, 1)
        }),

        isActive: Effect.fn("ToolRuntime.isActive")(function* (name) {
          return active.has(name)
        }),

        list: Effect.fn("ToolRuntime.list")(function* () {
          evictExpired(active, usageOrder)
          return Array.from(active.values()).map((t) => t.signature)
        }),

        listCatalog: Effect.fn("ToolRuntime.listCatalog")(function* () {
          return Array.from(catalog.values()).map((t) => t.signature)
        }),

        searchCatalog: Effect.fn("ToolRuntime.searchCatalog")(function* (query) {
          const q = query.toLowerCase()
          const results: ScoredSignature[] = []
          for (const instance of catalog.values()) {
            const sig = instance.signature
            let score = 0
            if (sig.name.toLowerCase().includes(q)) score += 10
            if (sig.description.toLowerCase().includes(q)) score += 5
            for (const key of Object.keys(sig.input)) {
              if (key.toLowerCase().includes(q)) score += 2
            }
            for (const key of Object.keys(sig.output)) {
              if (key.toLowerCase().includes(q)) score += 1
            }
            if (score > 0) results.push({ ...sig, score })
          }
          return results.sort((a, b) => b.score - a.score)
        }),

        setMaxActive: Effect.fn("ToolRuntime.setMaxActive")(function* (n) {
          maxActive = n
        }),
      })
    }),
  )
}
