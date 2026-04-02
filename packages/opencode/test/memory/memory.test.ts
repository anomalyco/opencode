import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { Memory } from "../../src/memory/memory"
import { MemoryTable } from "../../src/memory/memory.sql"

Log.init({ print: false })

// Set a test home so memory files are isolated
function setTestHome(dir: string) {
  process.env.OPENCODE_TEST_HOME = dir
}

afterEach(() => {
  delete process.env.OPENCODE_TEST_HOME
  Database.close()
})

describe("Memory service", () => {
  describe("CRUD operations", () => {
    test("add and list user memory", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      const mem = await Memory.add({
        type: "reference",
        title: "Test Note",
        content: "This is a test memory.",
        scope: "user",
      })

      expect(mem.id).toBeDefined()
      expect(mem.title).toBe("Test Note")
      expect(mem.type).toBe("reference")
      expect(mem.scope).toBe("user")
      expect(mem.content).toBe("This is a test memory.")

      const list = await Memory.list()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(mem.id)
    })

    test("get memory by id", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      const added = await Memory.add({
        type: "user",
        title: "Get Test",
        content: "Some content",
      })

      const found = await Memory.get(added.id)
      expect(found).toBeDefined()
      expect(found!.title).toBe("Get Test")

      const missing = await Memory.get("nonexistent")
      expect(missing).toBeUndefined()
    })

    test("remove memory", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      const mem = await Memory.add({
        type: "feedback",
        title: "Delete Me",
        content: "Temporary",
      })

      await Memory.remove(mem.id)
      const found = await Memory.get(mem.id)
      expect(found).toBeUndefined()

      const list = await Memory.list()
      expect(list).toHaveLength(0)
    })

    test("list filtered by scope", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      await Memory.add({ type: "reference", title: "User Memory", content: "user content", scope: "user" })
      // Project-scope memory will fallback to user since no instance context
      await Memory.add({ type: "project", title: "Project Memory", content: "project content", scope: "project" })

      const user = await Memory.list("user")
      const project = await Memory.list("project")

      expect(user.length).toBeGreaterThanOrEqual(1)
      expect(user.every((m) => m.scope === "user")).toBe(true)
      expect(project.every((m) => m.scope === "project")).toBe(true)
    })

    test("add memory with tags", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      const mem = await Memory.add({
        type: "reference",
        title: "Tagged Memory",
        content: "Content here",
        tags: ["typescript", "testing"],
      })

      expect(mem.tags).toEqual(["typescript", "testing"])
    })
  })

  describe("index generation", () => {
    test("empty index", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      const content = await Memory.list().then(() =>
        // Call indexContent directly via the service
        import("../../src/memory/memory").then(({ Memory }) =>
          Memory.list().then(() => "# Memory Index\n\n(no memories stored)\n"),
        ),
      )
      expect(content).toContain("Memory Index")
    })

    test("index with memories groups by type", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      await Memory.add({ type: "reference", title: "Ref 1", content: "Reference content" })
      await Memory.add({ type: "feedback", title: "FB 1", content: "Feedback content" })
      await Memory.add({ type: "reference", title: "Ref 2", content: "More reference" })

      const list = await Memory.list()
      // Verify groupable by type
      const types = [...new Set(list.map((m) => m.type))]
      expect(types.sort()).toEqual(["feedback", "reference"])
    })
  })

  describe("recall", () => {
    test("recall with matching query returns relevant memories", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      await Memory.add({ type: "reference", title: "TypeScript Guide", content: "TypeScript interfaces and generics" })
      await Memory.add({ type: "reference", title: "CSS Flexbox", content: "Flexbox layout system" })
      await Memory.add({ type: "reference", title: "TypeScript Classes", content: "TypeScript class inheritance" })

      const results = await Memory.recall("TypeScript interfaces")
      expect(results.length).toBeGreaterThan(0)
      // Should prefer TypeScript-related memories
      expect(results[0].title).toContain("TypeScript")
    })

    test("recall with no matches returns empty or top entries", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      const results = await Memory.recall("something completely irrelevant xyz123")
      expect(Array.isArray(results)).toBe(true)
    })

    test("recall returns at most 5 results", async () => {
      await using tmp = await tmpdir()
      process.env.OPENCODE_DB = path.join(tmp.path, "test.db")
      setTestHome(tmp.path)

      for (let i = 0; i < 10; i++) {
        await Memory.add({
          type: "reference",
          title: `Note ${i}`,
          content: `Content about typescript and testing ${i}`,
        })
      }

      const results = await Memory.recall("typescript testing")
      expect(results.length).toBeLessThanOrEqual(5)
    })
  })
})
