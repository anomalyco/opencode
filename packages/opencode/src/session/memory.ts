import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { and, eq, like, lt, or } from "drizzle-orm"
import { AgentMemoryTable } from "@opencode-ai/core/session/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import type { SessionID } from "./schema"
import { AgentMemoryID } from "./schema"

export interface AgentMemoryInput {
  sessionID?: SessionID
  type: string
  title: string
  content: string
  metadata?: {
    what?: string
    why?: string
    where?: string | string[]
    learned?: string
  }
  tags?: string[]
  strength?: number
}

export const AgentMemory = {
  save: Effect.fn("AgentMemory.save")(function* (projectID: ProjectV2.ID, input: AgentMemoryInput) {
    const { db } = yield* Database.Service
    const id = AgentMemoryID.descending()
    yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .insert(AgentMemoryTable)
            .values({
              id,
              project_id: projectID,
              session_id: input.sessionID ?? null,
              type: input.type,
              title: input.title,
              content: input.content,
              metadata: input.metadata ?? null,
              tags: input.tags ?? null,
              strength: input.strength ?? 100,
              status: "active",
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run()
        }),
      )
      .pipe(Effect.orDie)
    return id
  }),

  search: Effect.fn("AgentMemory.search")(function* (
    projectID: ProjectV2.ID,
    options?: { type?: string; keyword?: string; limit?: number },
  ) {
    const { db } = yield* Database.Service
    const conditions = [eq(AgentMemoryTable.project_id, projectID), eq(AgentMemoryTable.status, "active")]
    if (options?.type) conditions.push(eq(AgentMemoryTable.type, options.type))
    if (options?.keyword) {
      const pattern = `%${options.keyword}%`
      conditions.push(
        or(like(AgentMemoryTable.title, pattern), like(AgentMemoryTable.content, pattern)) as never,
      )
    }
    return yield* db
      .select()
      .from(AgentMemoryTable)
      .where(and(...conditions))
      .limit(options?.limit ?? 50)
      .all()
      .pipe(Effect.orDie)
  }),

  consolidate: Effect.fn("AgentMemory.consolidate")(function* (
    projectID: ProjectV2.ID,
    cutoffDays?: number,
  ) {
    const { db } = yield* Database.Service
    const cutoff = cutoffDays
      ? Date.now() - cutoffDays * 24 * 60 * 60 * 1000
      : Date.now() - 30 * 24 * 60 * 60 * 1000
    yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .update(AgentMemoryTable)
            .set({ status: "consolidated", time_updated: Date.now() })
            .where(
              and(
                eq(AgentMemoryTable.project_id, projectID),
                eq(AgentMemoryTable.status, "active"),
                lt(AgentMemoryTable.time_created, cutoff),
              ) as never,
            )
            .run()
        }),
      )
      .pipe(Effect.orDie)
  }),
}

export * as Memory from "./memory"