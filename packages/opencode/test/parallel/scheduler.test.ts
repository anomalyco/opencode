import { describe, expect, test } from "bun:test"
import { analyzeOverlaps, buildWaves, validatePlan } from "../../src/parallel/scheduler"
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

describe("Scheduler", () => {
  describe("analyzeOverlaps", () => {
    test("detects exact file overlap", () => {
      const subtasks = [createSubtask("a", ["src/file.ts"]), createSubtask("b", ["src/file.ts"])]

      const overlaps = analyzeOverlaps(subtasks)

      expect(overlaps).toHaveLength(1)
      expect(String(overlaps[0].subtaskA)).toBe("a")
      expect(String(overlaps[0].subtaskB)).toBe("b")
      expect(overlaps[0].overlappingFiles).toContain("src/file.ts")
    })

    test("detects parent directory overlap", () => {
      const subtasks = [createSubtask("a", ["src/utils"]), createSubtask("b", ["src/utils/helper.ts"])]

      const overlaps = analyzeOverlaps(subtasks)

      expect(overlaps).toHaveLength(1)
      expect(overlaps[0].overlappingFiles).toContain("src/utils")
      expect(overlaps[0].overlappingFiles).toContain("src/utils/helper.ts")
    })

    test("returns empty when no overlap", () => {
      const subtasks = [createSubtask("a", ["src/a.ts"]), createSubtask("b", ["src/b.ts"])]

      const overlaps = analyzeOverlaps(subtasks)

      expect(overlaps).toHaveLength(0)
    })

    test("handles empty file scopes", () => {
      const subtasks = [createSubtask("a", []), createSubtask("b", ["src/file.ts"])]

      const overlaps = analyzeOverlaps(subtasks)

      expect(overlaps).toHaveLength(0)
    })

    test("handles multiple overlapping pairs", () => {
      const subtasks = [
        createSubtask("a", ["src/shared.ts"]),
        createSubtask("b", ["src/shared.ts"]),
        createSubtask("c", ["src/shared.ts"]),
      ]

      const overlaps = analyzeOverlaps(subtasks)

      expect(overlaps).toHaveLength(3) // a-b, a-c, b-c
    })
  })

  describe("buildWaves", () => {
    test("puts disjoint subtasks in single parallel wave", () => {
      const subtasks = [
        createSubtask("a", ["src/a.ts"]),
        createSubtask("b", ["src/b.ts"]),
        createSubtask("c", ["src/c.ts"]),
      ]

      const analysis = buildWaves(subtasks)

      expect(analysis.waves).toHaveLength(1)
      expect(analysis.waves[0].type).toBe("parallel")
      expect(analysis.waves[0].subtasks).toHaveLength(3)
      expect(analysis.parallelizableCount).toBe(3)
      expect(analysis.serialCount).toBe(0)
    })

    test("creates serial waves for overlapping subtasks", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const analysis = buildWaves(subtasks)

      expect(analysis.waves).toHaveLength(2)
      expect(analysis.waves[0].type).toBe("serial")
      expect(analysis.waves[1].type).toBe("serial")
      expect(analysis.waves[0].subtasks).toHaveLength(1)
      expect(analysis.waves[1].subtasks).toHaveLength(1)
      expect(analysis.serialCount).toBe(2)
    })

    test("respects dependencies when building waves", () => {
      const subtasks = [
        createSubtask("a", ["src/a.ts"]),
        createSubtask("b", ["src/b.ts"], ["a"]),
        createSubtask("c", ["src/c.ts"], ["b"]),
      ]

      const analysis = buildWaves(subtasks)

      expect(analysis.waves).toHaveLength(3)
      expect(analysis.waves[0].subtasks.map(String)).toContain("a")
      expect(analysis.waves[1].subtasks.map(String)).toContain("b")
      expect(analysis.waves[2].subtasks.map(String)).toContain("c")
    })

    test("handles mixed parallel and serial subtasks", () => {
      const subtasks = [
        createSubtask("a", ["src/a.ts"]),
        createSubtask("b", ["src/b.ts"]),
        createSubtask("c", ["src/shared.ts"]),
        createSubtask("d", ["src/shared.ts"]),
      ]

      const analysis = buildWaves(subtasks)

      // a and b should be parallel, c and d serial
      expect(analysis.waves.length).toBeGreaterThanOrEqual(2)
      expect(analysis.parallelizableCount).toBe(2)
      expect(analysis.serialCount).toBe(2)
    })

    test("is deterministic - same input produces same output", () => {
      const subtasks = [
        createSubtask("a", ["src/a.ts"]),
        createSubtask("b", ["src/b.ts"]),
        createSubtask("c", ["src/shared.ts"]),
        createSubtask("d", ["src/shared.ts"]),
      ]

      const analysis1 = buildWaves(subtasks)
      const analysis2 = buildWaves(subtasks)

      expect(analysis1.waves).toEqual(analysis2.waves)
      expect(analysis1.overlaps).toEqual(analysis2.overlaps)
    })

    test("handles single subtask", () => {
      const subtasks = [createSubtask("a", ["src/a.ts"])]

      const analysis = buildWaves(subtasks)

      expect(analysis.waves).toHaveLength(1)
      expect(analysis.waves[0].subtasks.map(String)).toEqual(["a"])
      expect(analysis.waves[0].type).toBe("parallel")
    })

    test("wave indices are sequential", () => {
      const subtasks = [
        createSubtask("a", ["src/shared.ts"]),
        createSubtask("b", ["src/shared.ts"]),
        createSubtask("c", ["src/shared.ts"]),
      ]

      const analysis = buildWaves(subtasks)

      expect(analysis.waves[0].index).toBe(0)
      expect(analysis.waves[1].index).toBe(1)
      expect(analysis.waves[2].index).toBe(2)
    })
  })

  describe("validatePlan", () => {
    test("strict mode fails on overlaps", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const result = validatePlan(subtasks, "strict")

      expect(result.valid).toBe(false)
      expect(result.error).toContain("strict mode")
      expect(result.error).toContain("src/shared.ts")
    })

    test("strict mode passes when no overlaps", () => {
      const subtasks = [createSubtask("a", ["src/a.ts"]), createSubtask("b", ["src/b.ts"])]

      const result = validatePlan(subtasks, "strict")

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    test("auto mode passes even with overlaps", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const result = validatePlan(subtasks, "auto")

      expect(result.valid).toBe(true)
      expect(result.analysis.overlaps).toHaveLength(1)
    })

    test("off mode always passes", () => {
      const subtasks = [createSubtask("a", ["src/shared.ts"]), createSubtask("b", ["src/shared.ts"])]

      const result = validatePlan(subtasks, "off")

      expect(result.valid).toBe(true)
    })
  })
})
