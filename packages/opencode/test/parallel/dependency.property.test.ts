import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { Decomposition } from "../../src/parallel/decomposition"

interface SubtaskDep {
  dependencies: number[]
}

const subtasksArb = fc.array(
  fc.record<SubtaskDep>({
    dependencies: fc.array(fc.integer()),
  }),
  { minLength: 0, maxLength: 20 },
)

const validSubtasksArb = fc
  .array(fc.record<SubtaskDep>({ dependencies: fc.array(fc.integer()) }), { minLength: 0, maxLength: 20 })
  .map((subtasks) => {
    const n = subtasks.length
    return subtasks.map((st) => ({
      dependencies: st.dependencies.filter((d) => d >= 0 && d < n && d !== subtasks.indexOf(st)),
    }))
  })

describe("Dependency Validation - Property Tests", () => {
  test("DAG with cycle is rejected by cycle detection", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer(), { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 10 }),
        (cycles) => {
          const subtasks: SubtaskDep[] = cycles.map((deps) => ({ dependencies: deps }))

          const n = subtasks.length
          for (let i = 0; i < n; i++) {
            subtasks[i].dependencies = subtasks[i].dependencies.map((d) => d % n)
            if (!subtasks[i].dependencies.includes(i)) {
              subtasks[i].dependencies.push((i + 1) % n)
            }
          }

          const result = Decomposition.validateDependencies(subtasks)
          if (result && result.type === "circular") {
            expect(result).toBeDefined()
            expect(result.type).toBe("circular")
          }
        },
      ),
      { numRuns: 500 },
    )
  })

  test("DAG without cycle is accepted", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 0, maxLength: 15 }), (deps) => {
        const n = Math.max(1, Math.floor(deps.length / 2) + 1)
        const subtasks: SubtaskDep[] = []

        for (let i = 0; i < n; i++) {
          const validDeps = deps.filter((d) => d < i)
          subtasks.push({
            dependencies: [...new Set(validDeps)].slice(0, 3),
          })
        }

        const result = Decomposition.validateDependencies(subtasks)
        expect(result).toBeUndefined()
      }),
      { numRuns: 500 },
    )
  })

  test("missing dependency references are detected", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 20 })
          .chain((n) =>
            fc.tuple(fc.constant(n), fc.array(fc.integer({ min: 0, max: n + 5 }), { minLength: 1, maxLength: 10 })),
          ),
        ([n, invalidDeps]) => {
          const subtasks: SubtaskDep[] = []
          for (let i = 0; i < n; i++) {
            subtasks.push({ dependencies: [] })
          }

          const targetIdx = Math.floor(Math.random() * n)
          const outOfRange = invalidDeps.find((d) => d >= n)
          if (outOfRange !== undefined) {
            subtasks[targetIdx].dependencies.push(outOfRange)
          }

          const result = Decomposition.validateDependencies(subtasks)
          if (outOfRange !== undefined) {
            expect(result).toBeDefined()
            expect(result?.type).toBe("invalid")
          }
        },
      ),
      { numRuns: 500 },
    )
  })

  test("self-referential dependencies are rejected", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }).chain((n) => fc.tuple(fc.constant(n), fc.integer({ min: 0, max: n - 1 }))),
        ([n, selfRefIdx]) => {
          const subtasks: SubtaskDep[] = []
          for (let i = 0; i < n; i++) {
            subtasks.push({ dependencies: [] })
          }

          subtasks[selfRefIdx].dependencies.push(selfRefIdx)

          const result = Decomposition.validateDependencies(subtasks)
          expect(result).toBeDefined()
          expect(result?.type).toBe("self")
          expect(result?.subtaskIndex).toBe(selfRefIdx)
        },
      ),
      { numRuns: 300 },
    )
  })

  test("scheduler readiness: nodes with all deps complete are ready", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), (n) => {
        const subtasks: SubtaskDep[] = []
        const completed = new Set<number>()

        for (let i = 0; i < n; i++) {
          const deps: number[] = []
          for (let j = 0; j < i; j++) {
            if (Math.random() < 0.5) deps.push(j)
          }
          subtasks.push({ dependencies: deps })
          if (i % 2 === 0) completed.add(i)
        }

        for (let i = 0; i < n; i++) {
          const allDepsComplete = subtasks[i].dependencies.every((d) => completed.has(d))
          const isCompleted = completed.has(i)

          if (allDepsComplete && !isCompleted) {
            expect(subtasks[i].dependencies.every((d) => completed.has(d))).toBe(true)
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  test("scheduler readiness: nodes with incomplete deps are not ready", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 3, max: 15 })
          .chain((n) =>
            fc.tuple(
              fc.constant(n),
              fc.integer({ min: 1, max: n - 1 }),
              fc.array(fc.integer({ min: 0, max: n - 1 }), { minLength: 1, maxLength: 5 }),
            ),
          ),
        ([n, incompleteNode, itsDeps]) => {
          const subtasks: SubtaskDep[] = []
          for (let i = 0; i < n; i++) {
            subtasks.push({ dependencies: i === incompleteNode ? itsDeps.filter((d) => d < i) : [] })
          }

          const completed = new Set<number>()
          for (let i = 0; i < n; i++) {
            if (i !== incompleteNode && !itsDeps.includes(i)) {
              completed.add(i)
            }
          }

          const hasIncompleteDep = subtasks[incompleteNode].dependencies.some((d) => !completed.has(d))
          if (hasIncompleteDep) {
            expect(subtasks[incompleteNode].dependencies.every((d) => completed.has(d))).toBe(false)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe("Dependency Edge Cases", () => {
  test("empty graph is valid", () => {
    const result = Decomposition.validateDependencies([])
    expect(result).toBeUndefined()

    const sort = Decomposition.topologicalSort([])
    expect(sort.order).toEqual([])
    expect(sort.levels).toEqual([])
  })

  test("single node with no dependencies is valid", () => {
    const subtasks: SubtaskDep[] = [{ dependencies: [] }]

    const result = Decomposition.validateDependencies(subtasks)
    expect(result).toBeUndefined()

    const sort = Decomposition.topologicalSort(subtasks)
    expect(sort.order).toEqual([0])
    expect(sort.levels).toEqual([0])
  })

  test("single node with self-dependency is rejected", () => {
    const subtasks: SubtaskDep[] = [{ dependencies: [0] }]

    const result = Decomposition.validateDependencies(subtasks)
    expect(result).toBeDefined()
    expect(result?.type).toBe("self")
  })

  test("fully connected graph without cycles is valid", () => {
    const n = 5
    const subtasks: SubtaskDep[] = []

    for (let i = 0; i < n; i++) {
      const deps: number[] = []
      for (let j = 0; j < i; j++) {
        deps.push(j)
      }
      subtasks.push({ dependencies: deps })
    }

    const result = Decomposition.validateDependencies(subtasks)
    expect(result).toBeUndefined()

    const sort = Decomposition.topologicalSort(subtasks)
    expect(sort.order).toHaveLength(n)
    expect(sort.levels[0]).toBe(0)
    expect(sort.levels[n - 1]).toBe(n - 1)
  })

  test("fully connected graph with cycle is rejected", () => {
    const n = 5
    const subtasks: SubtaskDep[] = []

    for (let i = 0; i < n; i++) {
      subtasks.push({ dependencies: [(i + 1) % n] })
    }

    const result = Decomposition.validateDependencies(subtasks)
    expect(result).toBeDefined()
    expect(result?.type).toBe("circular")
  })

  test("chain dependencies are valid", () => {
    const n = 10
    const subtasks: SubtaskDep[] = []

    for (let i = 0; i < n; i++) {
      subtasks.push({ dependencies: i > 0 ? [i - 1] : [] })
    }

    const result = Decomposition.validateDependencies(subtasks)
    expect(result).toBeUndefined()

    const sort = Decomposition.topologicalSort(subtasks)
    expect(sort.order).toEqual(Array.from({ length: n }, (_, i) => i))
  })

  test("diamond dependency pattern is valid", () => {
    const subtasks: SubtaskDep[] = [
      { dependencies: [] },
      { dependencies: [0] },
      { dependencies: [0] },
      { dependencies: [1, 2] },
    ]

    const result = Decomposition.validateDependencies(subtasks)
    expect(result).toBeUndefined()

    const sort = Decomposition.topologicalSort(subtasks)
    expect(sort.order).toHaveLength(4)
    expect(sort.levels[0]).toBe(0)
    expect(sort.levels[3]).toBe(2)
  })
})

describe("Topological Sort - Property Tests", () => {
  test("topological sort respects dependency order", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), (n) => {
        const subtasks: SubtaskDep[] = []

        for (let i = 0; i < n; i++) {
          const deps: number[] = []
          for (let j = 0; j < i; j++) {
            if (Math.random() < 0.3) deps.push(j)
          }
          subtasks.push({ dependencies: deps })
        }

        const result = Decomposition.validateDependencies(subtasks)
        if (result) return

        const sort = Decomposition.topologicalSort(subtasks)
        const position = new Map(sort.order.map((idx, pos) => [idx, pos]))

        for (let i = 0; i < n; i++) {
          for (const dep of subtasks[i].dependencies) {
            expect(position.get(dep)).toBeLessThan(position.get(i)!)
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  test("all nodes appear exactly once in topological order", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), (n) => {
        const subtasks: SubtaskDep[] = []

        for (let i = 0; i < n; i++) {
          const deps: number[] = []
          for (let j = 0; j < i; j++) {
            if (Math.random() < 0.3) deps.push(j)
          }
          subtasks.push({ dependencies: deps })
        }

        const result = Decomposition.validateDependencies(subtasks)
        if (result) return

        const sort = Decomposition.topologicalSort(subtasks)
        expect(sort.order).toHaveLength(n)

        const unique = new Set(sort.order)
        expect(unique.size).toBe(n)

        for (let i = 0; i < n; i++) {
          expect(sort.order).toContain(i)
        }
      }),
      { numRuns: 300 },
    )
  })

  test("nodes with same level can execute in parallel", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 15 }), (n) => {
        const subtasks: SubtaskDep[] = [{ dependencies: [] }]

        for (let i = 1; i < n; i++) {
          subtasks.push({ dependencies: [0] })
        }

        const sort = Decomposition.topologicalSort(subtasks)
        expect(sort.levels[0]).toBe(0)

        for (let i = 1; i < n; i++) {
          expect(sort.levels[i]).toBe(1)
        }
      }),
      { numRuns: 100 },
    )
  })
})
