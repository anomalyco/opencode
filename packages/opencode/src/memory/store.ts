import { Database } from "../storage/db"

export interface MemoryEntry {
  sessionId: string
  projectDir: string
  title: string | null
  summary: string
  createdAt: number
}

interface MemoryRow {
  session_id: string
  project_dir: string
  title: string | null
  summary: string
  created_at: number
}

function fromRow(row: MemoryRow): MemoryEntry {
  return {
    sessionId: row.session_id,
    projectDir: row.project_dir,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

function client() {
  return Database.Client().$client
}

export const MemoryStore = {
  save(entry: MemoryEntry): void {
    client().run(
      `INSERT INTO memory (session_id, project_dir, title, summary, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary`,
      [entry.sessionId, entry.projectDir, entry.title, entry.summary, entry.createdAt],
    )
  },

  search(projectDir: string, query: string, limit = 5): MemoryEntry[] {
    const ftsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, '""')}"`)
      .join(" OR ")

    if (!ftsQuery) {
      return (
        client()
          .prepare(
            `SELECT session_id, project_dir, title, summary, created_at
             FROM memory WHERE project_dir = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(projectDir, limit) as MemoryRow[]
      ).map(fromRow)
    }

    return (
      client()
        .prepare(
          `SELECT m.session_id, m.project_dir, m.title, m.summary, m.created_at
           FROM memory_fts f
           JOIN memory m ON m.rowid = f.rowid
           WHERE memory_fts MATCH ? AND m.project_dir = ?
           ORDER BY rank LIMIT ?`,
        )
        .all(ftsQuery, projectDir, limit) as MemoryRow[]
    ).map(fromRow)
  },

  recent(projectDir: string, limit = 3): MemoryEntry[] {
    return (
      client()
        .prepare(
          `SELECT session_id, project_dir, title, summary, created_at
           FROM memory WHERE project_dir = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(projectDir, limit) as MemoryRow[]
    ).map(fromRow)
  },
}
