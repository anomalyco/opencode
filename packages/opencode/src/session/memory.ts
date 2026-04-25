import { Effect } from "effect"
import { Database, eq, and, or, like, lt } from "@/storage"
import { AgentMemoryTable } from "./session.sql"
import type { ProjectID } from "@/project/schema"
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

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

export const AgentMemory = {
  save: Effect.fn("AgentMemory.save")(function* (projectID: ProjectID, input: AgentMemoryInput) {
    const id = AgentMemoryID.descending()
    yield* Effect.sync(() =>
      Database.transaction((tx) => {
        tx.insert(AgentMemoryTable).values({
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
        }).run()
      }),
    )
    return id
  }),

  search: Effect.fn("AgentMemory.search")(function* (
    projectID: ProjectID,
    options?: { type?: string; keyword?: string; limit?: number },
  ) {
    return yield* db((tx) => {
      const conditions: (ReturnType<typeof eq> | ReturnType<typeof or> | undefined)[] = [
        eq(AgentMemoryTable.project_id, projectID),
        eq(AgentMemoryTable.status, "active"),
      ]
      if (options?.type) conditions.push(eq(AgentMemoryTable.type, options.type))
      if (options?.keyword) {
        const pattern = `%${options.keyword}%`
        conditions.push(
          or(
            like(AgentMemoryTable.title, pattern),
            like(AgentMemoryTable.content, pattern),
          ) as never,
        )
      }
      return tx
        .select()
        .from(AgentMemoryTable)
        .where(and(...conditions.filter(Boolean as never)))
        .limit(options?.limit ?? 50)
        .all()
    })
  }),

  consolidate: Effect.fn("AgentMemory.consolidate")(function* (
    projectID: ProjectID,
    cutoffDays?: number,
  ) {
    const cutoff = cutoffDays
      ? Date.now() - cutoffDays * 24 * 60 * 60 * 1000
      : Date.now() - 30 * 24 * 60 * 60 * 1000
    yield* Effect.sync(() =>
      Database.transaction((tx) => {
        tx
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
  }),
}
