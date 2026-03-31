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
    return Database.transaction(() => {
      Database.use((db) => {
        db.insert(MemoryTable).values({
          id: crypto.randomUUID(),
          project_path: input.projectPath,
          type: input.type,
          topic: input.topic,
          content: input.content,
          session_id: input.sessionId,
          access_count: 0,
        }).run()
      })
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

  export function incrementAccess(id: string) {
    return Database.use((db) => {
      db.update(MemoryTable)
        .set({
          access_count: sql`${MemoryTable.access_count} + 1`,
          time_updated: Date.now(),
        })
        .where(eq(MemoryTable.id, id))
        .run()
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
