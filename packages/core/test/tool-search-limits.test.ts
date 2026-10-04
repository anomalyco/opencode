import { describe, expect, test } from "bun:test"
import { GrepTool } from "../src/tool/grep"
import { GlobTool } from "../src/tool/glob"

describe("Search Limits & Output Bounding", () => {
  describe("GrepTool", () => {
    test("exports DEFAULT_LIMIT as 100", () => {
      expect(GrepTool.DEFAULT_LIMIT).toBe(100)
    })

    test("formats output cleanly when below limit", () => {
      const matches = [
        {
          entry: { path: "src/index.ts", type: "file" as const },
          line: 10,
          offset: 120,
          text: "const a = 1",
          submatches: [],
        },
        {
          entry: { path: "src/index.ts", type: "file" as const },
          line: 15,
          offset: 180,
          text: "const b = 2",
          submatches: [],
        },
      ]
      const output = GrepTool.toModelOutput(matches, 100)
      expect(output).toContain("Found 2 matches")
      expect(output).toContain("Line 10: const a = 1")
      expect(output).not.toContain("Results bounded at limit")
    })

    test("appends truncation advice when matches reach or exceed limit", () => {
      const matches = Array.from({ length: 50 }, (_, i) => ({
        entry: { path: `src/file_${i}.ts`, type: "file" as const },
        line: 1,
        offset: 0,
        text: "target match",
        submatches: [],
      }))
      const output = GrepTool.toModelOutput(matches, 50)
      expect(output).toContain("Found 50 matches")
      expect(output).toContain("Results bounded at limit of 50 matches")
      expect(output).toContain("Narrow search with path or include to see more")
    })
  })

  describe("GlobTool", () => {
    test("exports DEFAULT_LIMIT as 100", () => {
      expect(GlobTool.DEFAULT_LIMIT).toBe(100)
    })

    test("formats paths cleanly when below limit", () => {
      const entries = [
        { path: "src/a.ts", type: "file" as const },
        { path: "src/b.ts", type: "file" as const },
      ]
      const output = GlobTool.toModelOutput(entries, 100)
      expect(output).toBe("src/a.ts\nsrc/b.ts")
      expect(output).not.toContain("Results bounded at limit")
    })

    test("appends truncation advice when results reach or exceed limit", () => {
      const entries = Array.from({ length: 30 }, (_, i) => ({
        path: `src/pkg/file_${i}.ts`,
        type: "file" as const,
      }))
      const output = GlobTool.toModelOutput(entries, 30)
      expect(output).toContain("src/pkg/file_0.ts")
      expect(output).toContain("Results bounded at limit of 30 files")
      expect(output).toContain("Narrow search with a more specific path or pattern")
    })
  })
})
