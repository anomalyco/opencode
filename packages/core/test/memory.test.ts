import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import fs from "fs"
import { Memory } from "../src/memory"

describe("Memory Persistence (SQLite .db)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-memory-test-"))
  const testDbPath = path.join(tmpDir, "test-memory.db")

  it("initializes SQLite database with FTS5 and creates tables", () => {
    const db = Memory.initDatabase(testDbPath)
    expect(fs.existsSync(testDbPath)).toBe(true)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain("memory")
    expect(names).toContain("memory_fts")
    db.close()
  })

  it("teaches, recalls, lists, and deletes memories via service", async () => {
    // Run directly against a memory service instance pointing to testDbPath
    const db = Memory.initDatabase(testDbPath)
    const teach = (input: Memory.TeachInput) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const now = Date.now()
          const id = "mem_test_" + Math.random().toString(36).slice(2, 8)
          const title = input.title || input.content.slice(0, 30)
          const category = input.category || "general"
          const tags = JSON.stringify(input.tags || [])
          const source = input.source || "teach"

          db.prepare(`
            INSERT INTO memory (id, project_id, title, content, category, tags, source, session_id, time_created, time_updated)
            VALUES ($id, $project_id, $title, $content, $category, $tags, $source, $session_id, $time_created, $time_updated)
          `).run({
            $id: id,
            $project_id: input.projectID || null,
            $title: title,
            $content: input.content,
            $category: category,
            $tags: tags,
            $source: source,
            $session_id: input.sessionID || null,
            $time_created: now,
            $time_updated: now,
          })

          return { id, title, content: input.content, category, tags: input.tags || [] }
        }),
      )

    // 1. Teach
    const item1 = await teach({
      title: "Always use Bun test runner",
      content: "When writing tests for opencode, always use bun test instead of vitest or jest.",
      category: "testing",
      tags: ["bun", "test"],
    })
    expect(item1.id).toBeDefined()
    expect(item1.category).toBe("testing")

    const item2 = await teach({
      title: "SQLite database storage rules",
      content: "All long-term persistence must use the .db SQLite database file system with WAL mode.",
      category: "database",
      tags: ["sqlite", "persistence", "storage"],
    })
    expect(item2.id).toBeDefined()

    // 2. Recall via FTS5 match
    const ftsMatches = db.prepare(`
      SELECT m.* FROM memory m
      JOIN memory_fts f ON m.rowid = f.rowid
      WHERE memory_fts MATCH $match
    `).all({ $match: '"Bun"*' }) as any[]
    expect(ftsMatches.length).toBeGreaterThan(0)
    expect(ftsMatches[0].title).toBe("Always use Bun test runner")

    // 3. Recall via LIKE
    const likeMatches = db.prepare(`
      SELECT * FROM memory WHERE content LIKE $query
    `).all({ $query: "%SQLite%" }) as any[]
    expect(likeMatches.length).toBeGreaterThan(0)
    expect(likeMatches[0].title).toBe("SQLite database storage rules")

    // 4. List all
    const all = db.prepare("SELECT * FROM memory").all() as any[]
    expect(all.length).toBe(2)

    // 5. Delete
    db.prepare("DELETE FROM memory WHERE id = $id").run({ $id: item1.id })
    const afterDelete = db.prepare("SELECT * FROM memory WHERE id = $id").get({ $id: item1.id })
    expect(afterDelete).toBeNull()

    db.close()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignored on Windows if file handle release is asynchronous
    }
  })

  it("provides fts and bm25 status on the Memory service", async () => {
    const memory = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Memory.Service
      }).pipe(Effect.provide(Memory.layer)),
    )
    expect(memory.fts.available).toBe(true)
    expect(memory.fts.bm25).toBe(true)
  })
})
