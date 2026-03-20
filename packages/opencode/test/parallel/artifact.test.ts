import { describe, expect, test } from "bun:test"
import { analyze, validate, rewrite } from "../../src/parallel/artifact"
import { SubtaskID } from "../../src/parallel/schema"
import type { Subtask } from "../../src/parallel/schema"

describe("Artifact Analyzer", () => {
  function makeSubtask(
    id: string,
    title: string,
    description: string,
    fileScope: string[],
    dependencies: string[] = [],
  ): Subtask {
    return {
      id: SubtaskID.make(id),
      title,
      description,
      fileScope,
      dependencies: dependencies.map(SubtaskID.make),
    }
  }

  describe("analyze", () => {
    test("returns valid for empty subtasks", () => {
      const report = analyze([])
      expect(report.valid).toBe(true)
      expect(report.diagnostics).toHaveLength(0)
      expect(report.edges).toHaveLength(0)
    })

    test("detects implicit import dependency", () => {
      const producer = makeSubtask("1", "Create API", "Build the API layer", ["src/api.ts"])
      const consumer = makeSubtask("2", "Add API tests", "Test the API layer by importing from api", [
        "src/api.test.ts",
      ])

      const report = analyze([producer, consumer])

      expect(report.valid).toBe(false)
      expect(report.edges).toHaveLength(1)
      expect(report.edges[0].producer).toBe(producer.id)
      expect(report.edges[0].consumer).toBe(consumer.id)
      expect(report.edges[0].artifact).toBe("src/api.ts")
    })

    test("detects reference from title", () => {
      const producer = makeSubtask("1", "Create utils", "Build utilities", ["src/utils.ts"])
      const consumer = makeSubtask("2", "Use utils", "Use the utils module", ["src/feature.ts"])

      const report = analyze([producer, consumer])

      expect(report.edges.length).toBeGreaterThan(0)
      const edge = report.edges.find((e) => e.artifact === "src/utils.ts")
      expect(edge).toBeDefined()
    })

    test("finds missing dependency edges", () => {
      const producer = makeSubtask("1", "Create types", "Define types", ["src/types.ts"])
      const consumer = makeSubtask("2", "Implement feature", "Uses types from types module", ["src/feature.ts"])

      const report = analyze([producer, consumer])

      expect(report.missingDependencies.size).toBe(1)
      expect(report.missingDependencies.get(consumer.id)).toContain(producer.id)
    })

    test("ignores declared dependencies", () => {
      const producer = makeSubtask("1", "Create types", "Define types", ["src/types.ts"])
      const consumer = makeSubtask("2", "Implement feature", "Uses types from types module", ["src/feature.ts"], ["1"])

      const report = analyze([producer, consumer])

      // Should still detect the edge
      expect(report.edges.length).toBeGreaterThan(0)
      // But should not report as missing since it's declared
      expect(report.missingDependencies.get(consumer.id)).toBeUndefined()
    })

    test("detects cycles", () => {
      const a = makeSubtask("a", "Module Alpha", "Uses module beta", ["src/alpha.ts"])
      const b = makeSubtask("b", "Module Beta", "Uses module alpha", ["src/beta.ts"])

      const report = analyze([a, b])

      expect(report.valid).toBe(false)
      const cycleError = report.diagnostics.find((d) => d.code === "artifact_cycle")
      expect(cycleError).toBeDefined()
    })

    test("no false positives on disjoint subtasks", () => {
      const subtask1 = makeSubtask("1", "Frontend work", "UI components", ["src/ui.tsx"])
      const subtask2 = makeSubtask("2", "Backend work", "API routes", ["src/routes.ts"])

      const report = analyze([subtask1, subtask2])

      expect(report.valid).toBe(true)
      expect(report.edges).toHaveLength(0)
      expect(report.missingDependencies.size).toBe(0)
    })

    test("handles multiple consumers of same artifact", () => {
      const producer = makeSubtask("1", "Create lib", "Build library", ["src/lib.ts"])
      const consumer1 = makeSubtask("2", "Feature A", "Uses lib", ["src/feature-a.ts"])
      const consumer2 = makeSubtask("3", "Feature B", "Uses lib", ["src/feature-b.ts"])

      const report = analyze([producer, consumer1, consumer2])

      expect(report.edges).toHaveLength(2)
      expect(report.missingDependencies.size).toBe(2)
    })

    test("produces deterministic output", () => {
      const subtasks: Subtask[] = [
        makeSubtask("1", "A", "Desc", ["src/a.ts"]),
        makeSubtask("2", "B", "Desc", ["src/b.ts"]),
        makeSubtask("3", "C", "Desc", ["src/c.ts"]),
      ]

      const report1 = analyze(subtasks)
      const report2 = analyze(subtasks)

      expect(JSON.stringify(report1)).toBe(JSON.stringify(report2))
    })
  })

  describe("validate", () => {
    test("off mode always passes", () => {
      const subtasks = [makeSubtask("1", "A", "Desc", ["src/a.ts"]), makeSubtask("2", "B", "Uses a", ["src/b.ts"])]

      const result = validate(subtasks, "off")
      expect(result.valid).toBe(true)
    })

    test("strict mode fails on implicit deps", () => {
      const subtasks = [
        makeSubtask("1", "Base module", "Core types", ["src/base.ts"]),
        makeSubtask("2", "Feature module", "Uses base module", ["src/feature.ts"]),
      ]

      const result = validate(subtasks, "strict")
      expect(result.valid).toBe(false)
      expect(result.error).toContain("implicit")
    })

    test("does not infer dependency from parent directory alone", () => {
      const subtasks = [
        makeSubtask("1", "Build types", "Emit shared types", ["src/types.ts"]),
        makeSubtask("2", "Feature impl", "Implement feature logic", ["src/feature/impl.ts"]),
      ]

      const report = analyze(subtasks)
      expect(report.edges).toHaveLength(0)
      expect(report.missingDependencies.size).toBe(0)
      expect(report.valid).toBe(true)
    })

    test("warn mode passes but detects issues", () => {
      const subtasks = [makeSubtask("1", "A", "Desc", ["src/a.ts"]), makeSubtask("2", "B", "Uses a", ["src/b.ts"])]

      const result = validate(subtasks, "warn")
      expect(result.valid).toBe(true)
    })

    test("auto mode passes (for use in rewrite)", () => {
      const subtasks = [makeSubtask("1", "A", "Desc", ["src/a.ts"]), makeSubtask("2", "B", "Uses a", ["src/b.ts"])]

      const result = validate(subtasks, "auto")
      expect(result.valid).toBe(true)
    })
  })

  describe("rewrite", () => {
    test("adds missing dependencies deterministically", () => {
      const producer = makeSubtask("1", "Create lib", "Build library", ["src/lib.ts"])
      const consumer = makeSubtask("2", "Feature", "Uses lib", ["src/feature.ts"])

      const report = analyze([producer, consumer])
      const { rewritten, addedDeps } = rewrite([producer, consumer], report)

      expect(addedDeps).toBe(1)
      expect(rewritten[1].dependencies).toContain(producer.id)
    })

    test("preserves existing dependencies", () => {
      const a = makeSubtask("1", "A", "Desc", ["src/a.ts"])
      const b = makeSubtask("2", "B", "Desc", ["src/b.ts"], ["1"])
      const c = makeSubtask("3", "C", "Uses a", ["src/c.ts"], ["2"])

      const report = analyze([a, b, c])
      const { rewritten } = rewrite([a, b, c], report)

      expect(rewritten[1].dependencies).toContain(a.id)
      expect(rewritten[2].dependencies).toContain(b.id)
    })

    test("returns unchanged when no missing deps", () => {
      const subtasks = [makeSubtask("1", "A", "Desc", ["src/a.ts"]), makeSubtask("2", "B", "Desc", ["src/b.ts"])]

      const report = analyze(subtasks)
      const { rewritten, addedDeps } = rewrite(subtasks, report)

      expect(addedDeps).toBe(0)
      expect(rewritten).toEqual(subtasks)
    })

    test("handles multiple missing deps from same consumer", () => {
      const lib1 = makeSubtask("1", "Lib 1", "Desc", ["src/lib1.ts"])
      const lib2 = makeSubtask("2", "Lib 2", "Desc", ["src/lib2.ts"])
      const feature = makeSubtask("3", "Feature", "Uses lib1 and lib2", ["src/feature.ts"])

      const report = analyze([lib1, lib2, feature])
      const { rewritten, addedDeps } = rewrite([lib1, lib2, feature], report)

      expect(addedDeps).toBe(2)
      expect(rewritten[2].dependencies).toContain(lib1.id)
      expect(rewritten[2].dependencies).toContain(lib2.id)
    })
  })
})
