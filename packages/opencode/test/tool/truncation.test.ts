import { describe, test, expect, afterAll } from "bun:test"
import { Truncate } from "../../src/tool/truncation"
import { Identifier } from "../../src/id/id"
import fs from "fs/promises"
import path from "path"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

describe("Truncate", () => {
  describe("output", () => {
    test("truncates large json file by bytes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "models-api.json")).text()
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("truncated...")
      if (result.truncated) expect(result.outputPath).toBeDefined()
    })

    test("returns content unchanged when under limits", async () => {
      const content = "line1\nline2\nline3"
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(false)
      expect(result.content).toBe(content)
    })

    test("truncates by line count", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("...90 lines truncated...")
    })

    test("truncates by byte count", async () => {
      const content = "a".repeat(1000)
      const result = await Truncate.output(content, { maxBytes: 100 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("truncated...")
    })

    test("truncates from head by default", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 3 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("line0")
      expect(result.content).toContain("line1")
      expect(result.content).toContain("line2")
      expect(result.content).not.toContain("line9")
    })

    test("truncates from tail when direction is tail", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 3, direction: "tail" })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("line7")
      expect(result.content).toContain("line8")
      expect(result.content).toContain("line9")
      expect(result.content).not.toContain("line0")
    })

    test("uses default MAX_LINES and MAX_BYTES", () => {
      expect(Truncate.MAX_LINES).toBe(2000)
      expect(Truncate.MAX_BYTES).toBe(50 * 1024)
    })

    test("large single-line file truncates with byte message", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "models-api.json")).text()
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("bytes truncated...")
      expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(Truncate.MAX_BYTES)
    })

    test("writes full output to file when truncated", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = await Truncate.output(lines, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("The tool call succeeded but the output was truncated")
      expect(result.content).toContain("Grep")
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.outputPath).toBeDefined()
      expect(result.outputPath).toContain("tool_")

      const written = await Bun.file(result.outputPath).text()
      expect(written).toBe(lines)
    })

    test("suggests Task tool when agent has task permission", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const agent = { permission: [{ permission: "task", pattern: "*", action: "allow" as const }] }
      const result = await Truncate.output(lines, { maxLines: 10 }, agent as any)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("Grep")
      expect(result.content).toContain("Task tool")
    })

    test("omits Task tool hint when agent lacks task permission", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const agent = { permission: [{ permission: "task", pattern: "*", action: "deny" as const }] }
      const result = await Truncate.output(lines, { maxLines: 10 }, agent as any)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("Grep")
      expect(result.content).not.toContain("Task tool")
    })

    test("does not write file when not truncated", async () => {
      const content = "short content"
      const result = await Truncate.output(content)

      expect(result.truncated).toBe(false)
      if (result.truncated) throw new Error("expected not truncated")
      expect("outputPath" in result).toBe(false)
    })
  })

  describe("getMaxBytes", () => {
    test("returns fallback when no model provided", () => {
      const result = Truncate.getMaxBytes()
      expect(result).toBe(Truncate.MAX_BYTES)
    })

    test("returns fallback when model has no context limit", () => {
      const model = { limit: {} } as any
      const result = Truncate.getMaxBytes(model)
      expect(result).toBe(Truncate.MAX_BYTES)
    })

    test("returns fallback when context limit is 0", () => {
      const model = { limit: { context: 0 } } as any
      const result = Truncate.getMaxBytes(model)
      expect(result).toBe(Truncate.MAX_BYTES)
    })

    test("returns minimum 10KB for very small models", () => {
      const model = { limit: { context: 1000 } } as any
      const result = Truncate.getMaxBytes(model)
      expect(result).toBe(10 * 1024) // Should hit minimum
    })

    test("calculates correctly for GPT-4 (128k context)", () => {
      const model = { limit: { context: 128_000 } } as any
      const result = Truncate.getMaxBytes(model)
      // 128000 * 0.05 * 4 = 25600
      expect(result).toBe(25_600)
    })

    test("calculates correctly for Claude (200k context)", () => {
      const model = { limit: { context: 200_000 } } as any
      const result = Truncate.getMaxBytes(model)
      // 200000 * 0.05 * 4 = 40000
      expect(result).toBe(40_000)
    })

    test("calculates correctly for Gemini (2M context)", () => {
      const model = { limit: { context: 2_000_000 } } as any
      const result = Truncate.getMaxBytes(model)
      // 2000000 * 0.05 * 4 = 400000 (400KB, well under 2MB cap)
      expect(result).toBe(400_000)
    })

    test("caps at maximum 2MB for extremely large models", () => {
      const model = { limit: { context: 20_000_000 } } as any
      const result = Truncate.getMaxBytes(model)
      // Would calculate to 4000000 (4MB), but should cap at 2MB
      expect(result).toBe(2 * 1024 * 1024)
    })

    test("uses 5% of context converted to bytes (4 chars/token)", () => {
      const model = { limit: { context: 100_000 } } as any
      const result = Truncate.getMaxBytes(model)
      // 100000 * 0.05 * 4 = 20000
      expect(result).toBe(20_000)
    })
  })

  describe("getMaxMetadata", () => {
    test("returns 60% of max bytes when no model provided", () => {
      const result = Truncate.getMaxMetadata()
      expect(result).toBe(Math.floor(Truncate.MAX_BYTES * 0.6))
    })

    test("returns 60% of calculated max bytes for GPT-4", () => {
      const model = { limit: { context: 128_000 } } as any
      const result = Truncate.getMaxMetadata(model)
      const maxBytes = Truncate.getMaxBytes(model)
      expect(result).toBe(Math.floor(maxBytes * 0.6))
      expect(result).toBe(15_360) // 25600 * 0.6
    })

    test("returns 60% of calculated max bytes for Claude", () => {
      const model = { limit: { context: 200_000 } } as any
      const result = Truncate.getMaxMetadata(model)
      const maxBytes = Truncate.getMaxBytes(model)
      expect(result).toBe(Math.floor(maxBytes * 0.6))
      expect(result).toBe(24_000) // 40000 * 0.6
    })

    test("returns 60% of calculated max bytes for Gemini", () => {
      const model = { limit: { context: 2_000_000 } } as any
      const result = Truncate.getMaxMetadata(model)
      const maxBytes = Truncate.getMaxBytes(model)
      expect(result).toBe(Math.floor(maxBytes * 0.6))
      expect(result).toBe(240_000) // 400000 * 0.6
    })

    test("returns 60% of capped max bytes for extremely large models", () => {
      const model = { limit: { context: 20_000_000 } } as any
      const result = Truncate.getMaxMetadata(model)
      const maxBytes = Truncate.getMaxBytes(model)
      expect(result).toBe(Math.floor(maxBytes * 0.6))
      expect(result).toBe(Math.floor(2 * 1024 * 1024 * 0.6))
    })
  })

  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    let oldFile: string
    let recentFile: string

    afterAll(async () => {
      await fs.unlink(oldFile).catch(() => {})
      await fs.unlink(recentFile).catch(() => {})
    })

    test("deletes files older than 7 days and preserves recent files", async () => {
      await fs.mkdir(Truncate.DIR, { recursive: true })

      // Create an old file (10 days ago)
      const oldTimestamp = Date.now() - 10 * DAY_MS
      const oldId = Identifier.create("tool", false, oldTimestamp)
      oldFile = path.join(Truncate.DIR, oldId)
      await Bun.write(Bun.file(oldFile), "old content")

      // Create a recent file (3 days ago)
      const recentTimestamp = Date.now() - 3 * DAY_MS
      const recentId = Identifier.create("tool", false, recentTimestamp)
      recentFile = path.join(Truncate.DIR, recentId)
      await Bun.write(Bun.file(recentFile), "recent content")

      await Truncate.cleanup()

      // Old file should be deleted
      expect(await Bun.file(oldFile).exists()).toBe(false)

      // Recent file should still exist
      expect(await Bun.file(recentFile).exists()).toBe(true)
    })
  })
})
