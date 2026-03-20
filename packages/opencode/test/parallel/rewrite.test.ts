import { describe, expect, test } from "bun:test"
import { rewrite, validate, buildWaves } from "../../src/parallel/rewrite"
import { lint } from "../../src/parallel/lint"
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

describe("Rewriter", () => {
  describe("buildWaves", () => {
    test("puts disjoint subtasks in parallel wave", () => {
      const subtasks = [createSubtask("a", ["src/a.ts"]), createSubtask("b", ["src/b.ts"])]

      const waves = buildWaves(subtasks)

      expect(waves).toHaveLength(1)
      expect(waves[0].type).toBe("parallel")
      expect(waves[0].subtasks).toHaveLength(2)
    })

    test("creates serial waves for overlapping subtasks", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const waves = buildWaves(subtasks)

      expect(waves).toHaveLength(2)
      expect(waves[0].type).toBe("serial")
      expect(waves[1].type).toBe("serial")
    })
  })

  describe("rewrite", () => {
    test("returns original when no issues", () => {
      const subtasks = [createSubtask("a", ["src/a.ts"]), createSubtask("b", ["src/b.ts"])]
      const report = lint(subtasks)

      const result = rewrite(subtasks, report)

      expect(result.addedWiringSubtask).toBe(false)
      expect(result.rewrittenSubtasks).toHaveLength(2)
    })

    test("adds wiring subtask for hotspot files", () => {
      const subtasks = [createSubtask("a", ["src/a.ts", "src/cli/registry.ts"]), createSubtask("b", ["src/b.ts"])]
      const report = lint(subtasks)

      const result = rewrite(subtasks, report)

      expect(result.addedWiringSubtask).toBe(true)
      expect(result.rewrittenSubtasks).toHaveLength(3)

      const wiring = result.rewrittenSubtasks[2]
      expect(wiring.fileScope).toContain("src/cli/registry.ts")
      expect(wiring.title).toContain("wiring")
    })

    test("filters shared files from original subtasks", () => {
      const subtasks = [
        createSubtask("a", ["src/a.ts", "src/shared.ts"]),
        createSubtask("b", ["src/b.ts", "src/shared.ts"]),
      ]
      const report = lint(subtasks)

      const result = rewrite(subtasks, report)

      // Original subtasks should no longer have shared file
      const filteredA = result.rewrittenSubtasks[0]
      const filteredB = result.rewrittenSubtasks[1]
      expect(filteredA.fileScope).not.toContain("src/shared.ts")
      expect(filteredB.fileScope).not.toContain("src/shared.ts")

      // Wiring subtask should have shared file
      const wiring = result.rewrittenSubtasks[2]
      expect(wiring.fileScope).toContain("src/shared.ts")
    })

    test("wiring subtask depends on subtasks that touched shared files", () => {
      const subtasks = [createSubtask("a", ["src/a.ts", "src/cli/registry.ts"]), createSubtask("b", ["src/b.ts"])]
      const report = lint(subtasks)

      const result = rewrite(subtasks, report)

      const wiring = result.rewrittenSubtasks[2]
      expect(wiring.dependencies.map(String)).toContain("a")
      expect(wiring.dependencies.map(String)).not.toContain("b")
    })

    test("output is deterministic", () => {
      const subtasks = [
        createSubtask("c", ["src/c.ts", "src/shared.ts"]),
        createSubtask("a", ["src/a.ts"]),
        createSubtask("b", ["src/b.ts", "src/shared.ts"]),
      ]
      const report = lint(subtasks)

      const result1 = rewrite(subtasks, report)
      const result2 = rewrite(subtasks, report)

      expect(result1.addedWiringSubtask).toBe(result2.addedWiringSubtask)
      expect(result1.rewrittenSubtasks.map((s) => s.fileScope)).toEqual(
        result2.rewrittenSubtasks.map((s) => s.fileScope),
      )
    })
  })

  describe("validate", () => {
    test("off mode always passes", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const result = validate(subtasks, "off")

      expect(result.valid).toBe(true)
    })

    test("strict mode fails on errors", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const result = validate(subtasks, "strict")

      expect(result.valid).toBe(false)
      expect(result.error).toContain("duplicate_file_ownership")
    })

    test("strict mode passes when no errors", () => {
      const subtasks = [createSubtask("a", ["src/a.ts"]), createSubtask("b", ["src/b.ts"])]

      const result = validate(subtasks, "strict")

      expect(result.valid).toBe(true)
    })
  })
})
