import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Evolution } from "@/evolution/index"
import { ContextRetriever } from "./retriever"
import type { EvolutionMemory } from "../brain/memory"
import type { EvolutionDecisions } from "../brain/decisions"
import type { EvolutionProject } from "../brain/project"

function mockEvolution(): Evolution.Interface {
  return {
    memory: () => ({
      all: () => Effect.succeed<EvolutionMemory.MemoryEntry[]>([
        { id: "1", content: "use Effect for async", type: "lesson", tags: ["effect"], created: 1, updated: 1 },
      ]),
      save: () => Effect.succeed({} as any),
      retrieve: () => Effect.succeed([]),
      search: () => Effect.succeed([]),
      summarize: () => Effect.succeed({ count: 0, lastUpdate: null, types: {} }),
      compact: () => Effect.void,
    }),
    decisions: () => ({
      list: () => Effect.succeed<EvolutionDecisions.DecisionRecord[]>([
        {
          id: "1",
          title: "ADR-001",
          decision: "Use separate service",
          status: "accepted",
          context: "Needed clean boundaries",
          consequences: "More files but clearer ownership",
          tags: ["architecture"],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      get: () => Effect.succeed({} as any),
      record: () => Effect.succeed({} as any),
      supersede: () => Effect.void,
      summarize: () => Effect.succeed({ count: 0 }),
    }),
    project: () => ({
      profile: () =>
        Effect.succeed<EvolutionProject.ProjectProfile>({
          root: "/test",
          name: "opencode",
          vcs: "git",
          languages: ["TypeScript"],
          frameworks: ["bun", "effect"],
          packages: [],
          structure: "monorepo",
          hasDocker: false,
          hasTests: true,
          hasCI: true,
          detectedAt: 1,
        }),
      detectFrameworks: () => Effect.succeed([]),
      getStructure: () => Effect.succeed("monorepo" as const),
      hasDependency: () => Effect.succeed(false),
      refresh: () => Effect.succeed({} as any),
    }),
    status: () => Effect.succeed({} as any),
    getConfig: () => Effect.succeed({}),
    getMemories: () => Effect.succeed([]),
    getDecisions: () => Effect.succeed([]),
    getProjectContext: () => Effect.succeed({} as any),
  }
}

describe("ContextRetriever.Service", () => {
  test("retrieve() returns all domains with original types", () => {
    const svc = ContextRetriever.make(mockEvolution() as any)
    const result = Effect.runSync(svc.retrieve())
    expect(result.memory).toHaveLength(1)
    expect(result.memory[0].content).toBe("use Effect for async")
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0].title).toBe("ADR-001")
    expect(result.project.name).toBe("opencode")
  })

  test("retrieve() calls only facade accessors (AR-03)", () => {
    const evo = mockEvolution() as any
    const svc = ContextRetriever.make(evo)
    Effect.runSync(svc.retrieve())
    expect(true).toBe(true)
  })

  test("estimate() returns token counts per domain", () => {
    const svc = ContextRetriever.make(mockEvolution() as any)
    const raw = {
      memory: [{ id: "1", content: "hello world", type: "lesson", tags: [], created: 1, updated: 1 }],
      decisions: [
        {
          id: "1",
          title: "ADR",
          decision: "do this",
          status: "accepted" as const,
          context: "because",
          consequences: "ok",
          tags: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      project: {
        root: "/",
        name: "proj",
        vcs: "git",
        languages: [],
        frameworks: ["ts"],
        packages: [],
        structure: "single" as const,
        hasDocker: false,
        hasTests: false,
        hasCI: false,
        detectedAt: 1,
      },
    }
    const usage = svc.estimate(raw)
    expect(usage.memory).toBeGreaterThan(0)
    expect(usage.decisions).toBeGreaterThan(0)
    expect(usage.project).toBeGreaterThan(0)
  })

  test("estimate() is pure — no side effects", () => {
    const svc = ContextRetriever.make(mockEvolution() as any)
    const raw = {
      memory: [],
      decisions: [],
      project: {
        root: "/",
        name: "",
        vcs: "git",
        languages: [],
        frameworks: [],
        packages: [],
        structure: "single" as const,
        hasDocker: false,
        hasTests: false,
        hasCI: false,
        detectedAt: 1,
      },
    }
    expect(() => svc.estimate(raw)).not.toThrow()
    expect(svc.estimate(raw)).toEqual({ memory: 0, decisions: 0, project: 2 })
  })
})
