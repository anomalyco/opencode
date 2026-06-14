import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Context, Option, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { KeyedMutex } from "@opencode-ai/core/effect/keyed-mutex"
import { Config } from "@/config/config"
import { EvolutionStorageError, toEvolutionStorageError } from "@/evolution/error"
import path from "path"

export class EvolutionNotEnabledError extends Schema.TaggedErrorClass<EvolutionNotEnabledError>()("EvolutionDecisionsNotEnabledError", {
  message: Schema.String,
}) {}

export class AdrNotFoundError extends Schema.TaggedErrorClass<AdrNotFoundError>()("EvolutionAdrNotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

export interface DecisionRecord {
  id: string
  title: string
  status: "proposed" | "accepted" | "deprecated" | "superseded"
  context: string
  decision: string
  consequences: string
  tags: string[]
  sessionID?: string
  createdAt: number
  updatedAt: number
  supersededBy?: string
}

function nextID(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ADR-${ts}-${rand}`
}

export interface Interface {
  readonly save: (adr: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) => Effect.Effect<DecisionRecord, EvolutionNotEnabledError | EvolutionStorageError>
  readonly get: (id: string) => Effect.Effect<DecisionRecord | undefined, EvolutionStorageError>
  readonly list: (status?: string) => Effect.Effect<DecisionRecord[], EvolutionStorageError>
  readonly search: (query: string) => Effect.Effect<DecisionRecord[], EvolutionStorageError>
  readonly summarize: () => Effect.Effect<{ count: number; byStatus: Record<string, number> }, EvolutionStorageError>
  readonly supersede: (id: string, newADR: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) => Effect.Effect<DecisionRecord, AdrNotFoundError | EvolutionNotEnabledError | EvolutionStorageError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionDecisions") {}

function adrDir(worktree: string): string {
  return path.join(worktree, ".opencode", "evolution", "adr")
}

function mdPath(dir: string, id: string): string {
  return path.join(dir, `${id}.md`)
}

function jsonPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`)
}

function toMarkdown(adr: DecisionRecord): string {
  const lines = [
    `# ${adr.id}: ${adr.title}`,
    "",
    `**Status:** ${adr.status}`,
    `**Created:** ${new Date(adr.createdAt).toISOString()}`,
  ]
  if (adr.updatedAt !== adr.createdAt) {
    lines.push(`**Updated:** ${new Date(adr.updatedAt).toISOString()}`)
  }
  if (adr.sessionID) lines.push(`**Session:** ${adr.sessionID}`)
  if (adr.supersededBy) lines.push(`**Superseded By:** ${adr.supersededBy}`)
  if (adr.tags.length > 0) lines.push(`**Tags:** ${adr.tags.join(", ")}`)
  lines.push("", "## Context", "", adr.context, "", "## Decision", "", adr.decision, "", "## Consequences", "", adr.consequences, "")
  return lines.join("\n")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const mutex = KeyedMutex.makeUnsafe<string>()

    const state = yield* InstanceState.make(
      Effect.fn("EvolutionDecisions.state")(function* (ctx) {
        const cfg = yield* config.get()
        if (!cfg.evolution?.enabled) return undefined as string | undefined
        return adrDir(ctx.worktree)
      }),
    )

    const getDir = Effect.fn("EvolutionDecisions.getDir")(function* () {
      const dir = yield* InstanceState.get(state)
      if (!dir) return undefined
      return dir
    })

    const requireDir = (): Effect.Effect<string, EvolutionNotEnabledError> =>
      Effect.gen(function* () {
        const dir = yield* getDir()
        if (!dir) return yield* Effect.fail(new EvolutionNotEnabledError({ message: "Evolution not enabled" }))
        return dir
      })

    const ensureDir = Effect.fn("EvolutionDecisions.ensureDir")(function* () {
      const dir = yield* requireDir()
      yield* fs.ensureDir(dir)
      return dir
    })

    const loadFromJSON = Effect.fn("EvolutionDecisions.loadFromJSON")(function* (dir: string, id: string) {
      const jp = jsonPath(dir, id)
      const raw = yield* fs.readFileStringSafe(jp).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "read", jp))),
      )
      if (!raw) return undefined as DecisionRecord | undefined
      try {
        return JSON.parse(raw) as DecisionRecord
      } catch {
        return undefined as DecisionRecord | undefined
      }
    })

    const listAll = Effect.fn("EvolutionDecisions.listAll")(function* () {
      const dir = yield* requireDir().pipe(Effect.option)
      if (Option.isNone(dir)) return [] as DecisionRecord[]
      const entries = yield* fs.readDirectoryEntries(dir.value).pipe(Effect.catch(() => Effect.succeed([])))
      const jsonFiles = entries.filter((e) => e.name.endsWith(".json")).map((e) => e.name.slice(0, -5))
      const records: DecisionRecord[] = []
      for (const id of jsonFiles) {
        const rec = yield* loadFromJSON(dir.value, id)
        if (rec) records.push(rec)
      }
      return records.sort((a, b) => b.createdAt - a.createdAt)
    })

    const save = Effect.fn("EvolutionDecisions.save")(function* (input: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) {
      const dir = yield* requireDir()
      const now = Date.now()
      const adr: DecisionRecord = {
        ...input,
        id: nextID(),
        createdAt: now,
        updatedAt: now,
      }
      yield* fs.writeWithDirs(jsonPath(dir, adr.id), JSON.stringify(adr, null, 2)).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", jsonPath(dir, adr.id)))),
      )
      yield* fs.writeWithDirs(mdPath(dir, adr.id), toMarkdown(adr)).pipe(
        Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", mdPath(dir, adr.id)))),
      )
      return adr
    })

    const get = Effect.fn("EvolutionDecisions.get")(function* (id: string) {
      const dir = yield* getDir()
      if (!dir) return undefined
      return yield* loadFromJSON(dir, id)
    })

    const list = Effect.fn("EvolutionDecisions.list")(function* (status?: string) {
      const all = yield* listAll()
      if (status) return all.filter((a) => a.status === status)
      return all
    })

    const search = Effect.fn("EvolutionDecisions.search")(function* (query: string) {
      const all = yield* listAll()
      const lower = query.toLowerCase()
      return all.filter(
        (a) =>
          a.title.toLowerCase().includes(lower) ||
          a.context.toLowerCase().includes(lower) ||
          a.decision.toLowerCase().includes(lower) ||
          a.tags.some((t) => t.toLowerCase().includes(lower)),
      )
    })

    const summarize = Effect.fn("EvolutionDecisions.summarize")(function* () {
      const all = yield* listAll()
      const byStatus: Record<string, number> = {}
      for (const a of all) {
        byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
      }
      return { count: all.length, byStatus }
    })

    const supersede = Effect.fn("EvolutionDecisions.supersede")(function* (
      id: string,
      input: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">,
    ) {
      const dir = yield* requireDir()
      const existing = yield* get(id)
      if (!existing) return yield* Effect.fail(new AdrNotFoundError({ id, message: `ADR not found: ${id}` }))

      const now = Date.now()
      const updatedExisting: DecisionRecord = {
        ...existing,
        status: "superseded",
        updatedAt: now,
        supersededBy: undefined,
      }
      const newAdr: DecisionRecord = {
        ...input,
        id: nextID(),
        createdAt: now,
        updatedAt: now,
      }
      updatedExisting.supersededBy = newAdr.id

      const writes = [
        { path: jsonPath(dir, updatedExisting.id), content: JSON.stringify(updatedExisting, null, 2) },
        { path: mdPath(dir, updatedExisting.id), content: toMarkdown(updatedExisting) },
        { path: jsonPath(dir, newAdr.id), content: JSON.stringify(newAdr, null, 2) },
        { path: mdPath(dir, newAdr.id), content: toMarkdown(newAdr) },
      ] as const

      yield* mutex.withLock("decisions")(
        Effect.gen(function* () {
          for (const w of writes) {
            yield* fs.writeWithDirs(w.path, w.content).pipe(
              Effect.catch((e) => Effect.fail(toEvolutionStorageError(e, "write", w.path))),
            )
          }
        }),
      )
      return newAdr
    })

    return Service.of({ save, get, list, search, summarize, supersede })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
)

export const node = LayerNode.make(layer, [Config.node, FSUtil.node])

export * as EvolutionDecisions from "./decisions"
