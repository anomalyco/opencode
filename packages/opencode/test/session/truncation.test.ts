import { describe, test, expect } from "bun:test"
import { Truncate } from "../../src/session/truncation"
import path from "path"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

describe("Truncate", () => {
  describe("output", () => {
    test("truncates large json file by bytes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "models-api.json")).text()
      const result = Truncate.output(content)

      expect(result.truncated).toBe(true)
      expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(Truncate.MAX_BYTES + 100)
      expect(result.content).toContain("truncated...")
    })

    test("returns content unchanged when under limits", () => {
      const content = "line1\nline2\nline3"
      const result = Truncate.output(content)

      expect(result.truncated).toBe(false)
      expect(result.content).toBe(content)
    })

    test("truncates by line count", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      const result = Truncate.output(lines, { maxLines: 10 })

      expect(result.truncated).toBe(true)
      expect(result.content.split("\n").length).toBeLessThanOrEqual(12)
      expect(result.content).toContain("...90 lines truncated...")
    })

    test("truncates by byte count", () => {
      const content = "a".repeat(1000)
      const result = Truncate.output(content, { maxBytes: 100 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("truncated...")
    })

    test("truncates from head by default", () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = Truncate.output(lines, { maxLines: 3 })

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("line0")
      expect(result.content).toContain("line1")
      expect(result.content).toContain("line2")
      expect(result.content).not.toContain("line9")
    })

    test("truncates from tail when direction is tail", () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
      const result = Truncate.output(lines, { maxLines: 3, direction: "tail" })

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
      const result = Truncate.output(content)

      expect(result.truncated).toBe(true)
      expect(result.content).toContain("chars truncated...")
      expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(Truncate.MAX_BYTES)
    })
  })
})
