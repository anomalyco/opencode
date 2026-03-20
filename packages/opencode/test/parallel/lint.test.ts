import { describe, expect, test } from "bun:test"
import { lint, isHotspot } from "../../src/parallel/lint"
import { SubtaskID } from "../../src/parallel/schema"
import type { Subtask } from "../../src/parallel/schema"

function createSubtask(id: string, fileScope: string[], dependencies: string[] = []): Subtask {
  return {
    id: SubtaskID.make(id),
    title: `Subtask ${id}`,
    description: `Description for ${id}`,
    fileScope,
    dependencies: dependencies.map((d) => SubtaskID.make(d)),
  }
}

describe("Linter", () => {
  describe("isHotspot", () => {
    test("detects CLI index files", () => {
      expect(isHotspot("src/cli/cmd/parallel/index.ts")).toBe(true)
      expect(isHotspot("src/cli/cmd/config/index.ts")).toBe(true)
    })

    test("detects registry files", () => {
      expect(isHotspot("src/cli/registry.ts")).toBe(true)
    })

    test("detects main index", () => {
      expect(isHotspot("src/index.ts")).toBe(true)
    })

    test("detects orchestrator", () => {
      expect(isHotspot("src/parallel/orchestrator.ts")).toBe(true)
    })

    test("ignores non-hotspot files", () => {
      expect(isHotspot("src/utils/helper.ts")).toBe(false)
      expect(isHotspot("src/config/config.ts")).toBe(false)
    })
  })

  describe("lint", () => {
    test("passes valid disjoint subtasks", () => {
      const subtasks = [
        createSubtask("a", ["src/a.ts"]),
        createSubtask("b", ["src/b.ts"]),
        createSubtask("c", ["src/c.ts"]),
      ]

      const report = lint(subtasks)

      expect(report.valid).toBe(true)
      expect(report.summary.error).toBe(0)
    })

    test("detects duplicate file ownership", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const report = lint(subtasks)

      expect(report.valid).toBe(false)
      expect(report.summary.error).toBe(1)
      expect(report.issues[0].code).toBe("duplicate_file_ownership")
      expect(report.issues[0].severity).toBe("error")
    })

    test("detects file scope overlaps", () => {
      const subtasks = [createSubtask("a", ["src/utils"]), createSubtask("b", ["src/utils/helper.ts"])]

      const report = lint(subtasks)

      expect(report.summary.warn).toBeGreaterThanOrEqual(1)
      const overlapIssue = report.issues.find((i) => i.code === "file_scope_overlap")
      expect(overlapIssue).toBeDefined()
      expect(overlapIssue?.severity).toBe("warn")
    })

    test("detects hotspot files", () => {
      const subtasks = [createSubtask("a", ["src/cli/cmd/test/index.ts"])]

      const report = lint(subtasks)

      const hotspotIssue = report.issues.find((i) => i.code === "hotspot_file")
      expect(hotspotIssue).toBeDefined()
      expect(hotspotIssue?.severity).toBe("info")
    })

    test("error when hotspot claimed by multiple subtasks", () => {
      const subtasks = [createSubtask("a", ["src/cli/registry.ts"]), createSubtask("b", ["src/cli/registry.ts"])]

      const report = lint(subtasks)

      expect(report.valid).toBe(false)
      const hotspotIssue = report.issues.find((i) => i.code === "hotspot_file")
      expect(hotspotIssue).toBeDefined()
      expect(hotspotIssue?.severity).toBe("error")
    })

    test("issues are sorted by severity", () => {
      const subtasks = [
        createSubtask("a", ["src/shared.ts"]),
        createSubtask("b", ["src/shared.ts"]),
        createSubtask("c", ["src/cli/registry.ts"]),
        createSubtask("d", ["src/cli/registry.ts"]),
      ]

      const report = lint(subtasks)

      // All errors should come before warnings
      let seenWarn = false
      for (const issue of report.issues) {
        if (issue.severity === "warn") seenWarn = true
        if (issue.severity === "error") expect(seenWarn).toBe(false)
      }
    })

    test("includes recommendation for each issue", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const report = lint(subtasks)

      for (const issue of report.issues) {
        expect(issue.recommendation).toBeTruthy()
        expect(issue.recommendation.length).toBeGreaterThan(0)
      }
    })

    test("output is deterministic", () => {
      const subtasks = [
        createSubtask("c", ["src/c.ts"]),
        createSubtask("a", ["src/a.ts"]),
        createSubtask("b", ["src/b.ts"]),
      ]

      const report1 = lint(subtasks)
      const report2 = lint(subtasks)

      expect(report1.issues).toEqual(report2.issues)
      expect(report1.summary).toEqual(report2.summary)
      expect(report1.valid).toBe(report2.valid)
    })

    test("handles empty file scopes", () => {
      const subtasks = [createSubtask("a", []), createSubtask("b", ["src/file.ts"])]

      const report = lint(subtasks)

      expect(report.valid).toBe(true)
      expect(report.summary.error).toBe(0)
    })
  })
})
