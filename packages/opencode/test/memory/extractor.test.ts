import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { MemoryExtractor } from "../../src/memory/extractor"
import { MemoryStore } from "../../src/memory/store"

describe("MemoryExtractor", () => {
  const projectPath = "/test/project"

  beforeEach(() => {
    const db = Database.Client()
    try { db.run(`DELETE FROM memory`).run() } catch {}
    MemoryExtractor.init(projectPath, "test-session")
  })

  afterEach(() => {
    const db = Database.Client()
    try { db.run(`DELETE FROM memory`).run() } catch {}
    MemoryExtractor.reset()
  })

  test("detects build-command pattern (3+ same bash commands)", () => {
    const cmd = { command: "bun run build" }
    MemoryExtractor.onToolCall("bash", cmd)
    MemoryExtractor.onToolCall("bash", cmd)
    MemoryExtractor.onToolCall("bash", cmd)

    const memories = MemoryStore.search("Frequently used command")
    expect(memories.length).toBe(1)
    expect(memories[0].type).toBe("build-command")
  })

  test("does not false positive build-command with < 3 calls", () => {
    const cmd = { command: "bun run build" }
    MemoryExtractor.onToolCall("bash", cmd)
    MemoryExtractor.onToolCall("bash", cmd)

    const memories = MemoryStore.search("Frequently used command")
    expect(memories.length).toBe(0)
  })

  test("detects preference pattern in user messages", () => {
    MemoryExtractor.onUserMessage("No, don't use that. I prefer tabs instead of spaces.")
    const memories = MemoryStore.list(projectPath)
    expect(memories.length).toBe(1)
    expect(memories[0].type).toBe("preference")
  })

  test("detects config-pattern when editing config files", () => {
    MemoryExtractor.onToolCall("write", { file: "/project/package.json", content: "{}" })
    const memories = MemoryStore.list(projectPath)
    expect(memories.length).toBe(1)
    expect(memories[0].type).toBe("config-pattern")
  })

  test("detects decision pattern (3+ files edited in one turn)", () => {
    MemoryExtractor.onToolCall("edit", { file: "/project/a.ts", oldText: "", newText: "" })
    MemoryExtractor.onToolCall("edit", { file: "/project/b.ts", oldText: "", newText: "" })
    MemoryExtractor.onToolCall("edit", { file: "/project/c.ts", oldText: "", newText: "" })
    MemoryExtractor.onUserMessage("continue")

    const memories = MemoryStore.list(projectPath)
    expect(memories.some(m => m.type === "decision")).toBe(true)
  })

  test("detects error-solution pattern", () => {
    MemoryExtractor.onToolCall("bash", { command: "npm test" })
    MemoryExtractor.onToolResult("bash", { command: "npm test" }, "Error: test failed", 1)
    MemoryExtractor.onToolCall("edit", { file: "/project/test.ts", oldText: "bad", newText: "good" })

    const memories = MemoryStore.list(projectPath)
    expect(memories.some(m => m.type === "error-solution")).toBe(true)
  })

  test("does not detect false positive for normal operations", () => {
    MemoryExtractor.onToolCall("bash", { command: "ls" })
    MemoryExtractor.onToolResult("bash", { command: "ls" }, "file1\nfile2", 0)
    MemoryExtractor.onUserMessage("show me the files")

    const memories = MemoryStore.list(projectPath)
    // Should only have no memories since: bash used once, no preferences, no config edits
    expect(memories.length).toBe(0)
  })
})
