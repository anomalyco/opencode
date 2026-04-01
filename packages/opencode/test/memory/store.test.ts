import { test, expect, beforeAll, afterAll } from "bun:test"
import { MemoryStore } from "../../src/memory/store"
import { Memory } from "../../src/memory/memory"
import { Storage } from "../../src/storage/storage"
import path from "path"
import fs from "fs/promises"

const testDir = path.join(process.cwd(), "test-storage")

beforeAll(async () => {
  await fs.mkdir(testDir, { recursive: true })
})

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

test("save and retrieve a memory", async () => {
  const entry: Memory.Entry = {
    id: "test-1",
    content: "This is a test memory about TypeScript",
    tags: ["typescript", "programming"],
    projectID: "test-project",
    source: { sessionID: "session-1", agent: "build" },
    time: { created: Date.now(), accessed: Date.now() },
    accessCount: 0,
  }

  await MemoryStore.save(entry)
  const retrieved = await MemoryStore.get("test-1", "test-project")

  expect(retrieved).toBeDefined()
  expect(retrieved?.id).toBe("test-1")
  expect(retrieved?.content).toBe("This is a test memory about TypeScript")
  expect(retrieved?.tags).toEqual(["typescript", "programming"])
})

test("list memories by project", async () => {
  const entries: Memory.Entry[] = [
    {
      id: "test-2",
      content: "Memory about Rust",
      tags: ["rust"],
      projectID: "test-project-2",
      source: { manual: true },
      time: { created: Date.now(), accessed: Date.now() },
      accessCount: 0,
    },
    {
      id: "test-3",
      content: "Memory about Go",
      tags: ["go"],
      projectID: "test-project-2",
      source: { manual: true },
      time: { created: Date.now(), accessed: Date.now() },
      accessCount: 0,
    },
  ]

  await MemoryStore.save(entries[0])
  await MemoryStore.save(entries[1])

  const memories = await MemoryStore.list("test-project-2")

  expect(memories).toHaveLength(2)
  expect(memories.map((m) => m.id)).toEqual(expect.arrayContaining(["test-2", "test-3"]))
})

test("search memories across project", async () => {
  const entries: Memory.Entry[] = [
    {
      id: "test-4",
      content: "Introduction to machine learning algorithms",
      tags: ["ml", "ai"],
      projectID: "test-project-3",
      source: { manual: true },
      time: { created: Date.now(), accessed: Date.now() },
      accessCount: 0,
    },
    {
      id: "test-5",
      content: "Database optimization techniques",
      tags: ["database", "performance"],
      projectID: "test-project-3",
      source: { manual: true },
      time: { created: Date.now(), accessed: Date.now() },
      accessCount: 0,
    },
  ]

  await MemoryStore.save(entries[0])
  await MemoryStore.save(entries[1])

  const results = await MemoryStore.search("machine learning", "test-project-3", 10)

  expect(results).toHaveLength(1)
  expect(results[0].id).toBe("test-4")
})

test("delete a memory", async () => {
  const entry: Memory.Entry = {
    id: "test-6",
    content: "This will be deleted",
    tags: ["deletion"],
    projectID: "test-project-4",
    source: { manual: true },
    time: { created: Date.now(), accessed: Date.now() },
    accessCount: 0,
  }

  await MemoryStore.save(entry)
  const retrieved = await MemoryStore.get("test-6", "test-project-4")
  expect(retrieved).toBeDefined()

  await MemoryStore.remove("test-6", "test-project-4")
  const afterDelete = await MemoryStore.get("test-6", "test-project-4")

  expect(afterDelete).toBeNull()
})

test("touch updates access time and count", async () => {
  const entry: Memory.Entry = {
    id: "test-7",
    content: "Memory to touch",
    tags: ["touch"],
    projectID: "test-project-5",
    source: { manual: true },
    time: { created: Date.now(), accessed: Date.now() },
    accessCount: 0,
  }

  await MemoryStore.save(entry)
  const beforeTouch = await MemoryStore.get("test-7", "test-project-5")
  const originalAccessCount = beforeTouch?.accessCount

  await new Promise((resolve) => setTimeout(resolve, 10))
  await MemoryStore.touch("test-7", "test-project-5")

  const afterTouch = await MemoryStore.get("test-7", "test-project-5")

  expect(afterTouch?.accessCount).toBe((originalAccessCount || 0) + 1)
  expect(afterTouch?.time.accessed).toBeGreaterThan(beforeTouch?.time.accessed || 0)
})

test("getRecentForPrompt returns formatted memories", async () => {
  const now = Date.now()
  const entries: Memory.Entry[] = [
    {
      id: "test-8",
      content: "Old memory content",
      tags: ["old"],
      projectID: "test-project-6",
      source: { manual: true },
      time: { created: now - 10000, accessed: now - 5000 },
      accessCount: 1,
    },
    {
      id: "test-9",
      content: "Recent memory content",
      tags: ["recent"],
      projectID: "test-project-6",
      source: { manual: true },
      time: { created: now - 5000, accessed: now },
      accessCount: 5,
    },
  ]

  await MemoryStore.save(entries[0])
  await MemoryStore.save(entries[1])

  const recent = await MemoryStore.getRecentForPrompt("test-project-6", 1)

  expect(recent).toHaveLength(1)
  expect(recent[0]).toContain("Recent memory content")
})
