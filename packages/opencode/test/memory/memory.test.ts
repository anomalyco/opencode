import { test, expect } from "bun:test"
import { Memory } from "../../src/memory/memory"

test("create returns a valid memory entry", () => {
  const input = {
    content: "This is a test memory about TypeScript patterns",
    tags: ["typescript", "patterns", "design"],
    projectID: "proj_123",
    source: { sessionID: "ses_test", agent: "build", manual: false },
  }

  const result = Memory.create(input)

  expect(result.id).toBeDefined()
  expect(result.id).toMatch(/^mem_/)
  expect(result.content).toBe(input.content)
  expect(result.tags).toEqual(input.tags)
  expect(result.projectID).toBe(input.projectID)
  expect(result.source).toEqual(input.source)
  expect(result.time.created).toBeDefined()
  expect(result.time.accessed).toBeDefined()
  expect(result.accessCount).toBe(0)
})

test("scoreRelevance ranks recent + accessed memories higher", () => {
  const now = Date.now()
  const memories: Memory.Entry[] = [
    {
      id: "mem_recent",
      content: "important code snippet",
      tags: ["code"],
      projectID: "proj_123",
      source: { manual: true },
      time: { created: now, accessed: now },
      accessCount: 10,
    },
    {
      id: "mem_old",
      content: "important code snippet",
      tags: ["code"],
      projectID: "proj_123",
      source: { manual: true },
      time: { created: now - 7 * 24 * 60 * 60 * 1000, accessed: now - 7 * 24 * 60 * 60 * 1000 },
      accessCount: 10,
    },
  ]

  const scores = Memory.scoreRelevance(memories, "code snippet")
  const recentIndex = scores.findIndex((m) => m.id === "mem_recent")
  const oldIndex = scores.findIndex((m) => m.id === "mem_old")

  expect(recentIndex).toBeLessThan(oldIndex)
})

test("scoreRelevance boosts tag matches", () => {
  const now = Date.now()
  const memories: Memory.Entry[] = [
    {
      id: "mem_tagged",
      content: "some random content here",
      tags: ["important", "urgent", "fix"],
      projectID: "proj_123",
      source: { manual: true },
      time: { created: now, accessed: now },
      accessCount: 0,
    },
    {
      id: "mem_not_tagged",
      content: "important urgent fix right now",
      tags: ["other"],
      projectID: "proj_123",
      source: { manual: true },
      time: { created: now, accessed: now },
      accessCount: 0,
    },
  ]

  const scores = Memory.scoreRelevance(memories, "important urgent fix")
  const taggedIndex = scores.findIndex((m) => m.id === "mem_tagged")
  const notTaggedIndex = scores.findIndex((m) => m.id === "mem_not_tagged")

  expect(taggedIndex).toBeLessThan(notTaggedIndex)
})

test("search finds memories by content and tags", () => {
  const now = Date.now()
  const memories: Memory.Entry[] = [
    {
      id: "mem_1",
      content: "React component patterns for reusable UI",
      tags: ["react", "ui", "components"],
      projectID: "proj_web",
      source: { manual: true },
      time: { created: now, accessed: now },
      accessCount: 5,
    },
    {
      id: "mem_2",
      content: "Database connection pooling strategies",
      tags: ["database", "performance"],
      projectID: "proj_backend",
      source: { manual: true },
      time: { created: now, accessed: now },
      accessCount: 3,
    },
    {
      id: "mem_3",
      content: "Testing React hooks with Jest and React Testing Library",
      tags: ["testing", "react", "hooks"],
      projectID: "proj_web",
      source: { manual: true },
      time: { created: now, accessed: now },
      accessCount: 8,
    },
  ]

  const results = Memory.search(memories, "react components")
  expect(results.length).toBeGreaterThan(0)
  expect(results[0].id).toBe("mem_1")

  const tagResults = Memory.search(memories, "testing hooks")
  expect(tagResults.length).toBeGreaterThan(0)
  expect(tagResults[0].id).toBe("mem_3")
})
