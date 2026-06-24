import { Effect } from "effect"
import type { Evolution } from "../../../src/evolution/index"
import type { EvolutionMemory } from "../../../src/evolution/brain/memory"
import type { EvolutionDecisions } from "../../../src/evolution/brain/decisions"
import type { EvolutionProject } from "../../../src/evolution/brain/project"
import type { DecisionProposal } from "../../../src/evolution/decision/proposal"

export const memEntry = (overrides?: Partial<EvolutionMemory.MemoryEntry>): EvolutionMemory.MemoryEntry => ({
  id: "mem-1",
  type: "observation",
  content: "mock memory entry",
  tags: [],
  created: 0,
  updated: 0,
  ...overrides,
})

export const decRecord = (overrides?: Partial<EvolutionDecisions.DecisionRecord>): EvolutionDecisions.DecisionRecord => ({
  id: "adr-1",
  title: "mock decision",
  status: "accepted",
  context: "mock context",
  decision: "mock decision",
  consequences: "mock consequences",
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

export const projProfile = (overrides?: Partial<EvolutionProject.ProjectProfile>): EvolutionProject.ProjectProfile => ({
  root: "/mock/root",
  name: "mock-project",
  vcs: "git",
  languages: [],
  frameworks: [],
  packages: [],
  structure: "single",
  hasDocker: false,
  hasTests: false,
  hasCI: false,
  detectedAt: 0,
  ...overrides,
})

export const decisionProposal = (overrides?: Partial<DecisionProposal>): DecisionProposal => ({
  id: "prop-1",
  key: "mock-key",
  title: "mock proposal",
  context: "mock context",
  proposedDecision: "mock decision",
  consequences: "mock consequences",
  tags: [],
  origin: { proposerId: "mock-agent" },
  createdAt: 0,
  status: "SUBMITTED",
  ...overrides,
})

export const mockMemory = (overrides?: Partial<EvolutionMemory.Interface>): EvolutionMemory.Interface => ({
  save: () => Effect.succeed(memEntry()),
  retrieve: () => Effect.succeed([]),
  search: () => Effect.succeed([]),
  summarize: () => Effect.succeed({ count: 0, lastUpdate: null, types: {} }),
  compact: () => Effect.void,
  all: () => Effect.succeed([]),
  verify: () => Effect.never,
  detectAnomalies: () => Effect.succeed<EvolutionMemory.AnomalyWarning[]>([]),
  ...overrides,
})

export const mockDecisions = (overrides?: Partial<EvolutionDecisions.Interface>): EvolutionDecisions.Interface => ({
  save: () => Effect.succeed(decRecord()),
  saveReconciliationLog: () => Effect.void,
  get: () => Effect.succeed(undefined),
  list: () => Effect.succeed([]),
  search: () => Effect.succeed([]),
  summarize: () => Effect.succeed({ count: 0, byStatus: {} }),
  supersede: () => Effect.succeed(decRecord()),
  propose: () => Effect.succeed(decisionProposal()),
  submit: () => Effect.succeed(decisionProposal()),
  decisionRecord: () => Effect.succeed([]),
  listProposals: () => Effect.succeed([]),
  getReconciliationLogs: () => Effect.succeed([]),
  gc: () => Effect.succeed(0),
  getStorageStats: () => Effect.succeed({ proposalCount: 0, proposalBytes: 0, reconcilCount: 0, reconcilBytes: 0 }),
  ...overrides,
})

export const mockProject = (overrides?: Partial<EvolutionProject.Interface>): EvolutionProject.Interface => ({
  profile: () => Effect.succeed(projProfile()),
  detectFrameworks: () => Effect.succeed([]),
  getStructure: () => Effect.succeed("single"),
  hasDependency: () => Effect.succeed(false),
  refresh: () => Effect.succeed(projProfile()),
  ...overrides,
})

export const mockEvolution = (overrides?: Partial<Evolution.Interface>): Evolution.Interface => {
  const mem = mockMemory()
  const dec = mockDecisions()
  const proj = mockProject()
  return {
    memory: () => mem,
    decisions: () => dec,
    project: () => proj,
    status: () =>
      Effect.succeed({
        enabled: false,
        mode: "observe" as const,
        memory: { count: 0, lastUpdate: null },
        decisions: { count: 0 },
        project: { detected: false, root: "", frameworks: [] },
      }),
    getConfig: () => Effect.succeed({}),
    getMemories: () => Effect.succeed([]),
    getDecisions: () => Effect.succeed([]),
    getProjectContext: () => Effect.succeed(projProfile()),
    ...overrides,
  }
}
