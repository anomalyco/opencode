import { Database, eq, desc, like, sql, and } from "@/storage/db"
import { MemoryTable } from "./memory.sql"
import type { MemoryType } from "./types"
import { Log } from "../util/log"

const log = Log.create({ service: "memory.store" })

export namespace MemoryStore {
  export function save(input: {
    projectPath: string
    type: MemoryType
    topic: string
    content: string
    sessionId?: string
  }) {
    return Database.transaction((db) => {
      // UPSERT: merge with existing memory on same topic+project to avoid duplicates
      const existing = db
        .select()
        .from(MemoryTable)
        .where(
          and(
            eq(MemoryTable.topic, input.topic),
            eq(MemoryTable.project_path, input.projectPath),
          ),
        )
        .limit(1)
        .get()

      if (existing) {
        // Merge content: append new info if different, truncate input first
        const truncatedInput = input.content.length > 200 ? input.content.slice(0, 200) : input.content
        const mergedContent =
          existing.content.includes(truncatedInput)
            ? existing.content
            : `${existing.content}\n${truncatedInput}`
        db.update(MemoryTable)
          .set({
            content: mergedContent.slice(0, 500),
            access_count: sql`${MemoryTable.access_count} + 1`,
            time_updated: Date.now(),
          })
          .where(eq(MemoryTable.id, existing.id))
          .run()
        log.debug("merged memory", { topic: input.topic, id: existing.id })
      } else {
        db.insert(MemoryTable)
          .values({
            id: crypto.randomUUID(),
            project_path: input.projectPath,
            type: input.type,
            topic: input.topic,
            content: input.content,
            session_id: input.sessionId,
            access_count: 0,
          })
          .run()
        log.debug("saved memory", { type: input.type, topic: input.topic })
      }
    })
  }

  export function search(query: string, projectPath?: string) {
    return Database.use((db) => {
      const conditions = [like(MemoryTable.content, `%${query}%`)]
      if (projectPath) conditions.push(eq(MemoryTable.project_path, projectPath))
      return db
        .select()
        .from(MemoryTable)
        .where(and(...conditions))
        .orderBy(desc(MemoryTable.access_count), desc(MemoryTable.time_created))
        .limit(20)
        .all()
    })
  }

  export function getByTopic(topic: string, projectPath?: string) {
    return Database.use((db) => {
      const conditions = [eq(MemoryTable.topic, topic)]
      if (projectPath) conditions.push(eq(MemoryTable.project_path, projectPath))
      return db
        .select()
        .from(MemoryTable)
        .where(and(...conditions))
        .orderBy(desc(MemoryTable.time_created))
        .limit(1)
        .get()
    })
  }

  export function list(projectPath?: string, limit = 50) {
    return Database.use((db) => {
      const conditions = projectPath ? [eq(MemoryTable.project_path, projectPath)] : []
      return db
        .select()
        .from(MemoryTable)
        .where(and(...conditions))
        .orderBy(desc(MemoryTable.access_count), desc(MemoryTable.time_created))
        .limit(limit)
        .all()
    })
  }

  export function delete_(id: string) {
    return Database.use((db) => {
      db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run()
    })
  }

  export function compact(projectPath: string, maxLines = 200) {
    const memories = list(projectPath, 100)
    let lines = 0
    const sections: Record<string, typeof memories> = {}

    for (const m of memories) {
      if (lines >= maxLines) break
      const contentLines = m.content.split("\n").length
      if (lines + contentLines > maxLines) continue
      if (!sections[m.type]) sections[m.type] = []
      sections[m.type].push(m)
      lines += contentLines + 2
    }

    return sections
  }
}
