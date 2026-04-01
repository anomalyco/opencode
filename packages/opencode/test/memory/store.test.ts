import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { randomUUID } from "crypto"
import { MemoryStore } from "../../src/memory/store"
import { MemoryFile } from "../../src/memory/memory-file"
import path from "path"
import fs from "fs/promises"

describe("MemoryStore", () => {
  const projectPath = "/test/project"

  beforeEach(() => {
    const db = Database.Client()
    try { db.run(`DELETE FROM memory`).run() } catch {}
  })

  afterEach(() => {
    const db = Database.Client()
    try { db.run(`DELETE FROM memory`).run() } catch {}
  })

  test("save and retrieve a memory", () => {
    MemoryStore.save({
      projectPath,
      type: "general",
      topic: "test-topic",
      content: "Test content",
    })

    const memories = MemoryStore.list(projectPath)
    expect(memories.length).toBe(1)
    expect(memories[0].topic).toBe("test-topic")
    expect(memories[0].content).toBe("Test content")
    expect(memories[0].type).toBe("general")
    expect(memories[0].access_count).toBe(0)
  })

  test("search memories by content", () => {
    MemoryStore.save({ projectPath, type: "general", topic: "t1", content: "hello world" })
    MemoryStore.save({ projectPath, type: "general", topic: "t2", content: "foo bar" })

    const results = MemoryStore.search("hello")
    expect(results.length).toBe(1)
    expect(results[0].topic).toBe("t1")
  })

  test("getByTopic returns latest memory for topic (UPSERT merges)", async () => {
    MemoryStore.save({ projectPath, type: "general", topic: "shared", content: "first" })
    // Ensure different timestamp
    await new Promise(r => setTimeout(r, 10))
    MemoryStore.save({ projectPath, type: "general", topic: "shared", content: "second" })

    const result = MemoryStore.getByTopic("shared", projectPath)
    expect(result).toBeDefined()
    // UPSERT merges content when topic+project match
    expect(result!.content).toContain("first")
    expect(result!.content).toContain("second")
    expect(result!.access_count).toBe(1) // UPSERT increments on merge
  })

  test("UPSERT increments access_count on merge", () => {
    MemoryStore.save({ projectPath, type: "general", topic: "t1", content: "initial" })
    MemoryStore.save({ projectPath, type: "general", topic: "t1", content: "updated" })
    const result = MemoryStore.getByTopic("t1", projectPath)
    expect(result!.access_count).toBe(1) // UPSERT increments once on merge
  })

  test("delete removes a memory", () => {
    MemoryStore.save({ projectPath, type: "general", topic: "t1", content: "test" })
    const memories = MemoryStore.list(projectPath)
    expect(memories.length).toBe(1)

    MemoryStore.delete_(memories[0].id)
    const remaining = MemoryStore.list(projectPath)
    expect(remaining.length).toBe(0)
  })

  test("compact returns grouped memories", () => {
    MemoryStore.save({ projectPath, type: "error-solution", topic: "e1", content: "fixed a bug" })
    MemoryStore.save({ projectPath, type: "preference", topic: "p1", content: "use tabs" })
    MemoryStore.save({ projectPath, type: "error-solution", topic: "e2", content: "another fix" })

    const sections = MemoryStore.compact(projectPath)
    expect(sections["error-solution"]).toBeDefined()
    expect(sections["preference"]).toBeDefined()
  })
})

describe("MemoryFile", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = path.join(import.meta.dirname, ".tmp-memory-test-" + randomUUID().slice(0, 8))
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test("write and read memory file", async () => {
    await MemoryFile.writeMemoryFile(tmpDir, "# Test\n- item1\n- item2")
    const content = await MemoryFile.readMemoryFile(tmpDir)
    expect(content).toContain("Test")
    expect(content).toContain("item1")
  })

  test("readMemoryFile returns null for non-existent file", async () => {
    const content = await MemoryFile.readMemoryFile(tmpDir)
    expect(content).toBeNull()
  })

  test("updateMemoryFile creates file from store", async () => {
    // We need to insert into the DB first
    const db = Database.Client()
    try { db.run(`DELETE FROM memory`).run() } catch {}
    MemoryStore.save({ projectPath: tmpDir, type: "preference", topic: "t1", content: "use spaces" })

    await MemoryFile.updateMemoryFile(tmpDir)
    const content = await MemoryFile.readMemoryFile(tmpDir)
    expect(content).toContain("use spaces")
    expect(content).toContain("Preferences")

    // Cleanup
    try { db.run(`DELETE FROM memory`).run() } catch {}
  })
})
