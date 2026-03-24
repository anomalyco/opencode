// Browser-compatible migration runner for sql.js
// The opencode db.ts calls migrate(db, entries) with pre-compiled migration entries
export function migrate(db: any, entries: { sql: string; timestamp: number; name: string }[]) {
  const client = db?.session?.client ?? db?.$client ?? db

  // Create __drizzle_migrations table if needed
  client.run(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at INTEGER
  )`)

  for (const entry of entries) {
    // Check if migration already applied
    const hash = simpleHash(entry.sql)
    const statement = client.prepare(`SELECT id FROM "__drizzle_migrations" WHERE hash = ?`)
    let applied = false

    try {
      statement.bind([hash])
      applied = statement.step()
    } finally {
      statement.free()
    }

    if (applied) continue

    // Apply migration - split by statement-breakpoint comment
    const statements = entry.sql.split("--> statement-breakpoint")
    for (const stmt of statements) {
      const trimmed = stmt.trim()
      if (trimmed) {
        try {
          client.run(trimmed)
        } catch (e: any) {
          // Ignore "already exists" errors for idempotent migrations
          if (!e.message?.includes("already exists")) {
            console.warn(`Migration warning (${entry.name}):`, e.message)
          }
        }
      }
    }

    // Record migration
    client.run(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`, [hash, Date.now()])
  }
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return hash.toString(36)
}
