import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Context, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { KeyedMutex } from "@opencode-ai/core/effect/keyed-mutex"
import { Config } from "@/config/config"
import { EvolutionStorageError, toEvolutionStorageError } from "@/evolution/error"
import path from "path"

export class EvolutionNotEnabledError extends Schema.TaggedErrorClass<EvolutionNotEnabledError>()("EvolutionMemoryNotEnabledError", {
  message: Schema.String,
}) {}

export interface MemoryEntry {
  id: string
  type: "lesson" | "experience" | "pattern" | "error" | "observation"
  content: string
  tags: string[]
  sessionID?: string
  created: number
  updated: number
  metadata?: Record<string, unknown>
}

export interface MemoryStorage {
  readonly read: () => Effect.Effect<MemoryEntry[], FSUtil.Error>
  readonly write: (entries: MemoryEntry[]) => Effect.Effect<void, FSUtil.Error>
}

function makeJsonFileStorage(baseDir: string, fs: FSUtil.Interface): MemoryStorage {
  const filePath = path.join(baseDir, ".opencode", "evolution", "memory.json")
  return {
    read: () =>
      fs.readFileStringSafe(filePath).pipe(
        Effect.map((raw) => {
          if (!raw) return [] as MemoryEntry[]
          try {
            return JSON.parse(raw) as MemoryEntry[]
          } catch {
            return [] as MemoryEntry[]
          }
        }),
      ),
    write: (entries: MemoryEntry[]) =>
      fs.writeWithDirs(filePath, JSON.stringify(entries, null, 2)),
  }
}

function nextID(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export interface Interface {
  readonly save: (entry: Omit<MemoryEntry, "id" | "created" | "updated">) => Effect.Effect<MemoryEntry, EvolutionNotEnabledError | EvolutionStorageError>
  readonly retrieve: (query: { tags?: string[]; type?: string; limit?: number }) => Effect.Effect<MemoryEntry[], EvolutionStorageError>
  readonly search: (query: string, limit?: number) => Effect.Effect<MemoryEntry[], EvolutionStorageError>
  readonly summarize: () => Effect.Effect<{ count: number; lastUpdate: number | null; types: Record<string, number> }, EvolutionStorageError>
  readonly compact: () => Effect.Effect<void, EvolutionNotEnabledError | EvolutionStorageError>
  readonly all: () => Effect.Effect<MemoryEntry[], EvolutionStorageError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionMemory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const fs = yield* FSUtil.Service

    const state = yield* InstanceState.make(
      Effect.fn("EvolutionMemory.state")(function* (ctx) {
        const cfg = yield* config.get()
        if (!cfg.evolution?.enabled) return undefined as MemoryStorage | undefined
        return makeJsonFileStorage(ctx.worktree, fs)
      }),
    )

    const mutex = KeyedMutex.makeUnsafe<string>()

    const storage = (): Effect.Effect<MemoryStorage | undefined> =>
      Effect.gen(function* () {
        const s = yield* InstanceState.get(state)
        if (!s) return undefined
        return s
      })

    const requireStorage = (): Effect.Effect<MemoryStorage, EvolutionNotEnabledError> =>
      storage().pipe(
        Effect.flatMap((s) =>
          s ? Effect.succeed(s) : Effect.fail(new EvolutionNotEnabledError({ message: "Evolution not enabled" })),
        ),
      )

    const readStorage = (s: MemoryStorage) =>
      s.read().pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read"))),
      )

    const writeStorage = (s: MemoryStorage, entries: MemoryEntry[]) =>
      s.write(entries).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write"))),
      )

    const requireRead = Effect.fn("EvolutionMemory.requireRead")(function* () {
      const s = yield* requireStorage()
      return yield* readStorage(s)
    })

    const requireWrite = Effect.fn("EvolutionMemory.requireWrite")(function* (entries: MemoryEntry[]) {
      const s = yield* requireStorage()
      return yield* writeStorage(s, entries)
    })

    const save = Effect.fn("EvolutionMemory.save")(function* (entry: Omit<MemoryEntry, "id" | "created" | "updated">) {
      const result = yield* mutex.withLock("memory")(
        Effect.gen(function* () {
          const entries = yield* requireRead()
          const now = Date.now()
          const newEntry: MemoryEntry = {
            ...entry,
            id: nextID(),
            created: now,
            updated: now,
          }
          entries.push(newEntry)
          yield* requireWrite(entries)
          return newEntry
        }),
      )
      yield* compact().pipe(Effect.ignore)
      return result
    })

    const retrieve = Effect.fn("EvolutionMemory.retrieve")(function* (query: {
      tags?: string[]
      type?: string
      limit?: number
    }) {
      const s = yield* storage()
      if (!s) return [] as MemoryEntry[]
      const entries = yield* readStorage(s)
      let filtered = entries
      if (query.type) filtered = filtered.filter((e) => e.type === query.type)
      if (query.tags && query.tags.length > 0) {
        filtered = filtered.filter((e) => query.tags!.some((t) => e.tags.includes(t)))
      }
      if (query.limit) filtered = [...filtered].sort((a, b) => b.updated - a.updated).slice(0, query.limit)
      return filtered
    })

    const search = Effect.fn("EvolutionMemory.search")(function* (query: string, limit?: number) {
      const s = yield* storage()
      if (!s) return [] as MemoryEntry[]
      const entries = yield* readStorage(s)
      const lower = query.toLowerCase()
      const matched = entries.filter(
        (e) =>
          e.content.toLowerCase().includes(lower) ||
          e.tags.some((t) => t.toLowerCase().includes(lower)),
      )
      return limit ? matched.slice(0, limit) : matched
    })

    const summarize = Effect.fn("EvolutionMemory.summarize")(function* () {
      const s = yield* storage()
      if (!s) return { count: 0, lastUpdate: null, types: {} }
      const entries = yield* readStorage(s)
      const types: Record<string, number> = {}
      let lastUpdate: number | null = null
      for (const e of entries) {
        types[e.type] = (types[e.type] ?? 0) + 1
        if (e.updated > (lastUpdate ?? 0)) lastUpdate = e.updated
      }
      return { count: entries.length, lastUpdate, types }
    })

    const compact = Effect.fn("EvolutionMemory.compact")(function* () {
      const s = yield* requireStorage()
      const entries = yield* readStorage(s)
      if (entries.length <= 500) return
      const sorted = [...entries].sort((a, b) => b.updated - a.updated)
      yield* writeStorage(s, sorted.slice(0, 500))
    })

    const all = Effect.fn("EvolutionMemory.all")(function* () {
      const s = yield* storage()
      if (!s) return [] as MemoryEntry[]
      return yield* readStorage(s)
    })

    return Service.of({ save, retrieve, search, summarize, compact, all })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export const node = LayerNode.make(layer, [Config.node, FSUtil.node])

export * as EvolutionMemory from "./memory"
