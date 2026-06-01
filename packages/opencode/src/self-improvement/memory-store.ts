import { Context, Effect, Layer } from "effect"
import { eq, like, and, desc, lt, type SQL } from "@/storage/db"
import * as Database from "@/storage/db"
import { EventV2 } from "@opencode-ai/core/event"
import { memoryTable } from "./memory.sql"
import * as Log from "@opencode-ai/core/util/log"
import { SessionEvent } from "@opencode-ai/core/session-event"

const log = Log.create({ service: "memory.store" })

export type MemoryRow = {
  id: string
  session_id: string
  workspace_id: string | null
  type: string
  layer: string
  title: string
  content: string
  tags: string
  importance: number
  confidence: number
  access_count: number
  version: number
  time_created: number
  time_last_accessed: number
  time_last_evolved: number | null
  heartbeat_at: number | null
}

export type SearchResult = {
  id: string
  title: string
  content: string
  type: string
  layer: string
  tags: string[]
  importance: number
  confidence: number
  access_count: number
  relevance_score: number
}

export interface Interface {
  readonly store: (input: {
    sessionID: string
    title: string
    content: string
    type?: "episodic" | "semantic" | "procedural" | "pattern"
    layer?: "short_term" | "long_term" | "semantic" | "procedural"
    tags?: string[]
    importance?: number
    confidence?: number
  }) => Effect.Effect<string>

  readonly get: (id: string) => Effect.Effect<MemoryRow | undefined>

  readonly search: (input: {
    query: string
    type_filter?: string
    max_results?: number
  }) => Effect.Effect<SearchResult[]>

  readonly update: (
    id: string,
    input: Partial<{
      content: string
      title: string
      tags: string[]
      importance: number
      confidence: number
      layer: "short_term" | "long_term" | "semantic" | "procedural"
      access_count: number
      version: number
      time_last_evolved: number
      heartbeat_at: number
    }>,
  ) => Effect.Effect<void>

  readonly remove: (id: string) => Effect.Effect<void>

  readonly touchActive: (input: { minAccessCount: number }) => Effect.Effect<number>

  readonly compile: (agent: string, sessionID: string, messages: any[]) => Effect.Effect<string | null>

  readonly recordToolError: (data: { sessionID: string; tool: string; error: string }) => Effect.Effect<void>

  readonly recordCompaction: (data: { sessionID: string }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovement/MemoryStore") {}

function generateID(): string {
  return "mem_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    const store = Effect.fn("MemoryStore.store")(function* (input: {
      sessionID: string
      title: string
      content: string
      type?: "episodic" | "semantic" | "procedural" | "pattern"
      layer?: "short_term" | "long_term" | "semantic" | "procedural"
      tags?: string[]
      importance?: number
      confidence?: number
    }) {
      const id = generateID()
      const now = Date.now()

      Database.Client()
        .insert(memoryTable)
        .values({
          id,
          session_id: input.sessionID,
          workspace_id: null,
          type: input.type ?? "semantic",
          layer: input.layer ?? "long_term",
          title: input.title,
          content: input.content,
          tags: JSON.stringify(input.tags ?? []),
          importance: input.importance ?? 0.5,
          confidence: input.confidence ?? 0.8,
          access_count: 0,
          version: 1,
          time_created: now,
          time_last_accessed: now,
          time_last_evolved: null,
          heartbeat_at: null,
        })
        .run()

      return id
    })

    const get = Effect.fn("MemoryStore.get")(function* (id: string) {
      const row = Database.Client()
        .select()
        .from(memoryTable)
        .where(eq(memoryTable.id, id))
        .get() as MemoryRow | undefined

      return row
    })

    const search = Effect.fn("MemoryStore.search")(function* (input: {
      query: string
      type_filter?: string
      max_results?: number
    }) {
      const maxResults = input.max_results ?? 10

      const conditions: SQL[] = []

      if (input.query) {
        conditions.push(like(memoryTable.title, `%${input.query}%`) as unknown as SQL)
      }

      if (input.type_filter) {
        conditions.push(eq(memoryTable.type, input.type_filter as "episodic" | "semantic" | "procedural" | "pattern") as unknown as SQL)
      }

      const rows = Database.Client()
        .select()
        .from(memoryTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(memoryTable.importance), desc(memoryTable.time_last_accessed))
        .limit(maxResults)
        .all() as MemoryRow[]

      return rows.map((row) => {
        const contentMatch = input.query
          ? row.content.toLowerCase().includes(input.query.toLowerCase())
          : false
        const titleMatch = input.query
          ? row.title.toLowerCase().includes(input.query.toLowerCase())
          : false

        let relevanceScore = row.importance
        if (titleMatch) relevanceScore = Math.min(relevanceScore + 0.15, 1)
        if (contentMatch) relevanceScore = Math.min(relevanceScore + 0.05, 1)

        return {
          id: row.id,
          title: row.title,
          content: row.content,
          type: row.type,
          layer: row.layer,
          tags: JSON.parse(row.tags),
          importance: row.importance,
          confidence: row.confidence,
          access_count: row.access_count,
          relevance_score: relevanceScore,
        }
      })
    })

    const update = Effect.fn("MemoryStore.update")(function* (
      id: string,
      input: Partial<{
        content: string
        title: string
        tags: string[]
        importance: number
        confidence: number
        layer: "short_term" | "long_term" | "semantic" | "procedural"
        access_count: number
        version: number
        time_last_evolved: number
        heartbeat_at: number
      }>,
    ) {
      const setValues: Record<string, unknown> = {}

      if (input.content !== undefined) setValues.content = input.content
      if (input.title !== undefined) setValues.title = input.title
      if (input.tags !== undefined) setValues.tags = JSON.stringify(input.tags)
      if (input.importance !== undefined) setValues.importance = input.importance
      if (input.confidence !== undefined) setValues.confidence = input.confidence
      if (input.layer !== undefined) setValues.layer = input.layer
      if (input.access_count !== undefined) setValues.access_count = input.access_count
      if (input.version !== undefined) setValues.version = input.version
      if (input.time_last_evolved !== undefined) setValues.time_last_evolved = input.time_last_evolved
      if (input.heartbeat_at !== undefined) setValues.heartbeat_at = input.heartbeat_at

      if (Object.keys(setValues).length === 0) return

      Database.Client()
        .update(memoryTable)
        .set(setValues)
        .where(eq(memoryTable.id, id))
        .run()
    })

    const remove = Effect.fn("MemoryStore.remove")(function* (id: string) {
      Database.Client()
        .delete(memoryTable)
        .where(eq(memoryTable.id, id))
        .run()
    })

    const touchActive = Effect.fn("MemoryStore.touchActive")(function* (input: { minAccessCount: number }) {
      const now = Date.now()

      const candidates = Database.Client()
        .select()
        .from(memoryTable)
        .where(lt(memoryTable.access_count, input.minAccessCount))
        .all() as MemoryRow[]

      for (const row of candidates) {
        Database.Client()
          .update(memoryTable)
          .set({ access_count: input.minAccessCount, time_last_accessed: now })
          .where(eq(memoryTable.id, row.id))
          .run()
      }

      return candidates.length
    })

    const compile = Effect.fn("MemoryStore.compile")(function* (
      agent: string,
      sessionID: string,
      _messages: any[],
    ) {
      const rows = Database.Client()
        .select()
        .from(memoryTable)
        .where(eq(memoryTable.session_id, sessionID))
        .orderBy(desc(memoryTable.importance))
        .limit(5)
        .all() as MemoryRow[]

      if (rows.length === 0) return null

      const lines = ["## Relevant Memories"]
      for (const row of rows) {
        const snippet = row.content.length > 120
          ? row.content.slice(0, 120) + "..."
          : row.content
        const confidence = Math.round(row.confidence * 100)
        lines.push(`- **${row.title}** (confidence: ${confidence}%) — ${snippet}`)
      }

      return lines.join("\n")
    })

    const recordToolError = Effect.fn("MemoryStore.recordToolError")(function* (data: {
      sessionID: string
      tool: string
      error: string
    }) {
      const id = generateID()
      const now = Date.now()

      Database.Client()
        .insert(memoryTable)
        .values({
          id,
          session_id: data.sessionID,
          workspace_id: null,
          type: "episodic",
          layer: "short_term",
          title: `Tool error: ${data.tool}`,
          content: `Tool ${data.tool} failed with error: ${data.error}`,
          tags: JSON.stringify([data.tool, "error"]),
          importance: 0.4,
          confidence: 1.0,
          access_count: 0,
          version: 1,
          time_created: now,
          time_last_accessed: now,
          time_last_evolved: null,
          heartbeat_at: null,
        })
        .run()

      log.info("recorded tool error", { tool: data.tool, sessionID: data.sessionID })
    })

    const recordCompaction = Effect.fn("MemoryStore.recordCompaction")(function* (data: {
      sessionID: string
    }) {
      const id = generateID()
      const now = Date.now()

      Database.Client()
        .insert(memoryTable)
        .values({
          id,
          session_id: data.sessionID,
          workspace_id: null,
          type: "episodic",
          layer: "procedural",
          title: "Compaction performed",
          content: "Session context was compacted to manage token usage.",
          tags: JSON.stringify(["compaction"]),
          importance: 0.2,
          confidence: 1.0,
          access_count: 0,
          version: 1,
          time_created: now,
          time_last_accessed: now,
          time_last_evolved: null,
          heartbeat_at: null,
        })
        .run()

      log.info("recorded compaction", { sessionID: data.sessionID })
    })

    // Subscribe to EventV2 events for auto-recording
    const unsubscribe = yield* events.sync((event) => {
      if (event.type === SessionEvent.Step.Ended.type) {
        const data = event.data as { sessionID: string; finish: string }
        return store({
          sessionID: data.sessionID,
          title: `Step completed: ${data.finish}`,
          content: `Step finished with status: ${data.finish}`,
          type: "episodic",
          layer: "short_term",
          importance: 0.3,
        }).pipe(Effect.ignore)
      }

      if (event.type === SessionEvent.Tool.Failed.type) {
        const data = event.data as { sessionID: string; error: { type: string; message: string }; callID: string }
        return recordToolError({
          sessionID: data.sessionID,
          tool: data.error.type,
          error: data.error.message,
        }).pipe(Effect.ignore)
      }

      if (event.type === SessionEvent.Compaction.Ended.type) {
        const data = event.data as { sessionID: string }
        return recordCompaction({
          sessionID: data.sessionID,
        }).pipe(Effect.ignore)
      }

      return Effect.void
    })

    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({
      store,
      get,
      search,
      update,
      remove,
      touchActive,
      compile,
      recordToolError,
      recordCompaction,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer))

export * as MemoryStore from "./memory-store"
