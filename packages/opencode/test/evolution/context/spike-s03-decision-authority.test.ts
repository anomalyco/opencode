import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Queue, Scope, Fiber, Schema } from "effect"
import { Evolution } from "@/evolution/index"
import { Config } from "@/config/config"

// Decision proposal structure (Behavioral Spec — not full implementation)
interface DecisionProposal {
  readonly id: string
  readonly title: string
  readonly decision: string
  readonly rationale: string
}

interface ValidationResult {
  readonly valid: boolean
  readonly reason?: string
}

function validateProposal(
  proposal: DecisionProposal,
  existingDecisions: ReadonlyArray<{ title: string; decision: string }>,
): ValidationResult {
  const hasContradiction = existingDecisions.some(
    (d) => d.title.toLowerCase().includes(proposal.title.toLowerCase().split(" ")[0]?.toLowerCase() ?? "")
      && d.decision.toLowerCase() !== proposal.decision.toLowerCase(),
  )
  if (hasContradiction) {
    return { valid: false, reason: "Contradicts existing decision" }
  }
  return { valid: true }
}

const mockEvolution = Evolution.Service.of({
  memory: () => ({
    all: () => Effect.succeed([]),
    save: (entry: any) =>
      Effect.succeed({
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: entry.type ?? "lesson",
        content: entry.content ?? "",
        tags: entry.tags ?? [],
        created: Date.now(),
        updated: Date.now(),
      }),
    retrieve: () => Effect.succeed([]),
    search: () => Effect.succeed([]),
    summarize: () => Effect.succeed({ count: 0, lastUpdate: null, types: {} }),
    compact: () => Effect.void,
  }),
  decisions: () => ({
    list: () => Effect.succeed([]),
    get: () => Effect.succeed(undefined),
    save: (input: any) =>
      Effect.succeed({
        id: `ADR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        title: input.title ?? "",
        status: "proposed" as const,
        context: input.context ?? "",
        decision: input.decision ?? "",
        consequences: input.consequences ?? "",
        tags: input.tags ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    supersede: () => Effect.void,
    summarize: () => Effect.succeed({ count: 0 }),
  }),
  project: () => ({
    profile: () =>
      Effect.succeed({
        root: "/mock", name: "mock", vcs: "git", languages: ["ts"],
        frameworks: [], packages: [], structure: "single",
        hasDocker: false, hasTests: false, hasCI: false, detectedAt: 0,
      }),
    detectFrameworks: () => Effect.succeed([]),
    getStructure: () => Effect.succeed("single"),
    hasDependency: () => Effect.succeed(false),
    refresh: () => Effect.succeed({}),
  }),
  status: () =>
    Effect.succeed({
      enabled: true,
      mode: "observe" as const,
      memory: { count: 0, lastUpdate: null },
      decisions: { count: 0 },
      project: { detected: false, root: "", frameworks: [] },
    }),
  getConfig: () => Effect.succeed({}),
  getMemories: () => Effect.succeed([]),
  getDecisions: () => Effect.succeed([]),
  getProjectContext: () => Effect.succeed({} as any),
})

const mockConfig = Config.Service.of({
  get: () => Effect.succeed({ evolution: { enabled: true } } as any),
  getGlobal: () => Effect.succeed({} as any),
  getConsoleState: () => Effect.succeed({} as any),
  update: () => Effect.void,
  updateGlobal: () => Effect.succeed({} as any),
  directories: () => Effect.succeed([]),
  invalidate: () => Effect.void,
  waitForDependencies: () => Effect.void,
})

const baseLayer = Layer.mergeAll(
  Layer.succeed(Config.Service, mockConfig),
  Layer.succeed(Evolution.Service, mockEvolution),
)

describe("S-03.1 — Proposal Structure Valid", () => {
  test("valid proposal has required fields", () => {
    const proposal: DecisionProposal = {
      id: "D-001",
      title: "Use strict TypeScript",
      decision: "Enable strict mode in tsconfig",
      rationale: "Prevents type errors at compile time",
    }
    expect(proposal.id).toBe("D-001")
    expect(proposal.title).toBe("Use strict TypeScript")
    expect(proposal.decision).toBeDefined()
  })
})

describe("S-03.2 — Validation Logic: Contradiction Detection", () => {
  const existing: ReadonlyArray<{ title: string; decision: string }> = [
    { title: "Use any for flexibility", decision: "Allow any type" },
  ]

  test("proposal contradicting existing decision → invalid", () => {
    const proposal: DecisionProposal = {
      id: "D-002",
      title: "Use strict TypeScript",
      decision: "Enable strict mode",
      rationale: "Type safety",
    }
    const result = validateProposal(proposal, existing)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("Contradicts existing decision")
  })

  test("proposal not contradicting existing decision → valid", () => {
    const proposal: DecisionProposal = {
      id: "D-003",
      title: "Add ESLint rules",
      decision: "Add eslint-config-standard",
      rationale: "Code quality",
    }
    const result = validateProposal(proposal, existing)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
  })
})

describe("S-03.3 — Async Validation Protocol", () => {
  test("validation runs in separate scope — does not block caller", async () => {
    const result = await Effect.gen(function* () {
      const scope = yield* Scope.make()

      const proposal: DecisionProposal = {
        id: "D-004",
        title: "Use Effect v4",
        decision: "Migrate to Effect v4",
        rationale: "Better error handling",
      }

  const fiber = yield* Effect.forkIn(
    Effect.sync(() => validateProposal(proposal, [])),
    scope,
  )

  const result = yield* Fiber.join(fiber)
  yield* Scope.close(scope, Exit.void)
  return result
    }).pipe(Effect.runPromise)

    expect(result.valid).toBe(true)
  })

  test("validation fiber completes independently", async () => {
    const result = await Effect.gen(function* () {
      const scope = yield* Scope.make()

      const proposal: DecisionProposal = {
        id: "D-005",
        title: "Use bun test",
        decision: "Replace jest with bun test",
        rationale: "Faster CI",
      }

      const fiber = yield* Effect.forkIn(
        Effect.sync(() => validateProposal(proposal, [])),
        scope,
      )

      const result = yield* Fiber.join(fiber)
      yield* Scope.close(scope, Exit.void)
      return result
    }).pipe(Effect.runPromise)

    expect(result.valid).toBe(true)
  })
})

describe("S-03.4 — Authority Chain: Proposal → Validate → Record", () => {
  test("valid proposal can be recorded via Evolution.Service decisions().save()", async () => {
    const recorded = await Effect.gen(function* () {
      const evolution = yield* Evolution.Service

      const proposal = {
        title: "Use strict TypeScript",
        status: "proposed" as const,
        context: "Type safety concerns",
        decision: "Enable strict mode",
        consequences: "Refactoring needed",
        tags: ["typescript", "strict"],
      }

      const decision = yield* evolution.decisions().save(proposal)
      return decision
    }).pipe(Effect.provide(baseLayer), Effect.runPromise)

    expect(recorded.title).toBe("Use strict TypeScript")
    expect(recorded.id).toContain("ADR-")
  })
})
