export * as ReflectionState from "./reflection-state"

import { SessionSchema } from "../schema"

export interface Hypothesis {
  readonly id: string
  readonly description: string
  readonly probability: number
  readonly evidence: readonly string[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ConfidenceRecord {
  readonly predictedConfidence: number
  readonly actualOutcome: "success" | "failure" | "partial"
  readonly toolName: string
  readonly timestamp: Date
}

export interface CausalNode {
  readonly id: string
  readonly type: "observation" | "goal" | "action" | "assumption"
  readonly description: string
  readonly dependsOn: readonly string[]
  readonly confidence: number
  readonly timestamp: Date
}

export interface CausalEdge {
  readonly from: string
  readonly to: string
  readonly type: "supports" | "contradicts" | "enables" | "requires"
  readonly strength: number
}

export interface ReasoningLogEntry {
  readonly id: string
  readonly type: "why_loop" | "then_loop" | "pre_action" | "hypothesis_update" | "evi_score" | "counterfactual" | "self_consistency" | "temporal_guard"
  readonly content: string
  readonly metadata: Record<string, unknown>
  readonly timestamp: Date
}

export interface State {
  readonly directionConfirmed: boolean
  readonly lastWhyConverged: boolean
  readonly lastThenConverged: boolean
  readonly confirmedAt?: Date
  readonly steers: readonly string[]
  readonly hypotheses: readonly Hypothesis[]
  readonly confidenceHistory: readonly ConfidenceRecord[]
  readonly causalNodes: readonly CausalNode[]
  readonly causalEdges: readonly CausalEdge[]
  readonly reasoningLog: readonly ReasoningLogEntry[]
  readonly riskBudget: { readonly used: number; readonly limit: number }
  readonly temporalGuards: readonly TemporalGuard[]
}

export interface TemporalGuard {
  readonly id: string
  readonly formula: string
  readonly description: string
  readonly status: "pending" | "satisfied" | "violated"
  readonly createdAt: Date
}

const store = new Map<string, State>()

const empty: State = {
  directionConfirmed: false,
  lastWhyConverged: false,
  lastThenConverged: false,
  steers: [],
  hypotheses: [],
  confidenceHistory: [],
  causalNodes: [],
  causalEdges: [],
  reasoningLog: [],
  riskBudget: { used: 0, limit: 100 },
  temporalGuards: [],
}

export const get = (sessionID: SessionSchema.ID): State => store.get(sessionID) ?? empty

export const set = (sessionID: SessionSchema.ID, state: State): void => {
  store.set(sessionID, state)
}

export const clear = (sessionID: SessionSchema.ID): void => {
  store.delete(sessionID)
}

export const clearDirection = (sessionID: SessionSchema.ID): void => {
  const prev = get(sessionID)
  store.set(sessionID, {
    ...prev,
    directionConfirmed: false,
    lastWhyConverged: false,
    lastThenConverged: false,
  })
}

export const addSteer = (sessionID: SessionSchema.ID, steer: string): void => {
  const prev = get(sessionID)
  store.set(sessionID, {
    ...prev,
    directionConfirmed: false,
    steers: [...prev.steers, steer],
  })
}

export const hasSteers = (sessionID: SessionSchema.ID): boolean => {
  return (store.get(sessionID)?.steers.length ?? 0) > 0
}

export const consumeSteers = (sessionID: SessionSchema.ID): readonly string[] => {
  const prev = store.get(sessionID)
  if (!prev || prev.steers.length === 0) return []
  store.set(sessionID, { ...prev, steers: [] })
  return prev.steers
}

export const consumeSteerGuidanceText = (sessionID: SessionSchema.ID): string | undefined => {
  const steers = consumeSteers(sessionID)
  if (steers.length === 0) return undefined
  return [
    "<reflection_guidance>",
    "The following internal reflection/forward check was projected from recent actions:",
    ...steers,
    "Address these points in your next action or response.",
    "</reflection_guidance>",
  ].join("\n")
}

export const getReflectionText = (sessionID: SessionSchema.ID): string | undefined => {
  const state = get(sessionID)
  const parts: string[] = []

  if (state.directionConfirmed) {
    parts.push(
      "Direction confirmed: no counter-models or contradictions projected. Invariants validated.",
      "You may proceed confidently without re-checking.",
      `Last reflection: Why=${state.lastWhyConverged ? "converged" : "not run"}, Then=${state.lastThenConverged ? "converged" : "not run"}.`,
    )
  }

  if (state.hypotheses.length > 0) {
    parts.push("Active competing hypotheses:")
    for (const h of state.hypotheses) {
      parts.push(`- [${Math.round(h.probability * 100)}%] ${h.description}`)
    }
  }

  const pendingGuards = state.temporalGuards.filter((g) => g.status === "pending")
  if (pendingGuards.length > 0) {
    parts.push("Active invariants / guards:")
    for (const g of pendingGuards) {
      parts.push(`- ${g.formula}: ${g.description}`)
    }
  }

  if (parts.length === 0) return undefined
  return ["<reflection_state>", ...parts, "</reflection_state>"].join("\n")
}

export const setHypotheses = (
  sessionID: SessionSchema.ID,
  hypotheses: ReadonlyArray<Omit<Hypothesis, "id" | "createdAt" | "updatedAt">>,
): void => {
  const prev = get(sessionID)
  const now = new Date()
  const list: Hypothesis[] = hypotheses.map((h, i) => ({
    ...h,
    id: `hyp_${Date.now()}_${i}`,
    createdAt: now,
    updatedAt: now,
  }))
  store.set(sessionID, { ...prev, hypotheses: list })
}

export const addHypothesis = (sessionID: SessionSchema.ID, hypothesis: Omit<Hypothesis, "id" | "createdAt" | "updatedAt">): string => {
  const prev = get(sessionID)
  const id = `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const now = new Date()
  const newHypothesis: Hypothesis = {
    ...hypothesis,
    id,
    createdAt: now,
    updatedAt: now,
  }
  store.set(sessionID, {
    ...prev,
    hypotheses: [...prev.hypotheses, newHypothesis],
  })
  return id
}

export const updateHypothesis = (sessionID: SessionSchema.ID, hypothesisId: string, updates: Partial<Omit<Hypothesis, "id" | "createdAt">>): void => {
  const prev = get(sessionID)
  const hypotheses = prev.hypotheses.map((h) =>
    h.id === hypothesisId ? { ...h, ...updates, updatedAt: new Date() } : h
  )
  store.set(sessionID, { ...prev, hypotheses })
}

export const getHypotheses = (sessionID: SessionSchema.ID): readonly Hypothesis[] => {
  return get(sessionID).hypotheses
}

export const normalizeHypotheses = (sessionID: SessionSchema.ID): void => {
  const prev = get(sessionID)
  const total = prev.hypotheses.reduce((sum, h) => sum + h.probability, 0)
  if (total > 0) {
    const hypotheses = prev.hypotheses.map((h) => ({ ...h, probability: h.probability / total }))
    store.set(sessionID, { ...prev, hypotheses })
  }
}

export const isDistributionFlat = (
  sessionID: SessionSchema.ID,
  options?: { readonly maxProbabilityGap?: number; readonly minEntropy?: number },
): boolean => {
  const hypotheses = getHypotheses(sessionID)
  if (hypotheses.length < 2) return false
  const sorted = [...hypotheses].sort((a, b) => b.probability - a.probability)
  const p1 = sorted[0]!.probability
  const p2 = sorted[1]!.probability
  const gap = Math.abs(p1 - p2)
  const maxGap = options?.maxProbabilityGap ?? 0.15
  if (gap < maxGap) return true

  const probs = sorted.map((h) => h.probability)
  const sum = probs.reduce((a, b) => a + b, 0)
  if (sum > 0) {
    const normalized = probs.map((p) => p / sum)
    const ent = -normalized.reduce((acc, p) => acc + (p > 0 ? p * Math.log2(p) : 0), 0)
    const minEntropy = options?.minEntropy ?? 0.9
    if (ent >= minEntropy) return true
  }

  return false
}

export interface CandidateToolVote {
  readonly name: string
  readonly input: unknown
  readonly candidateIndex: number
}

export interface MajorityVoteResult {
  readonly winner: CandidateToolVote
  readonly votes: number
  readonly totalCandidates: number
  readonly consensusRatio: number
  readonly hadTie: boolean
}

export const computeMajorityVote = (
  candidates: ReadonlyArray<{ readonly name: string; readonly input: unknown }>,
): MajorityVoteResult | undefined => {
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) {
    return {
      winner: { ...candidates[0]!, candidateIndex: 0 },
      votes: 1,
      totalCandidates: 1,
      consensusRatio: 1,
      hadTie: false,
    }
  }

  const canonicalKey = (c: { readonly name: string; readonly input: unknown }): string => {
    try {
      if (typeof c.input === "object" && c.input !== null) {
        const sorted = Object.keys(c.input as Record<string, unknown>)
          .sort()
          .reduce((acc, key) => {
            acc[key] = (c.input as Record<string, unknown>)[key]
            return acc
          }, {} as Record<string, unknown>)
        return `${c.name}::${JSON.stringify(sorted)}`
      }
      return `${c.name}::${String(c.input)}`
    } catch {
      return `${c.name}::${String(c.input)}`
    }
  }

  const clusters = new Map<string, { count: number; candidate: CandidateToolVote }>()
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    const key = canonicalKey(c)
    const existing = clusters.get(key)
    if (existing) {
      existing.count++
    } else {
      clusters.set(key, { count: 1, candidate: { ...c, candidateIndex: i } })
    }
  }

  const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.count - a.count)
  const top = sortedClusters[0]!
  const second = sortedClusters[1]
  const hadTie = second !== undefined && second.count === top.count

  return {
    winner: top.candidate,
    votes: top.count,
    totalCandidates: candidates.length,
    consensusRatio: Math.round((top.count / candidates.length) * 100) / 100,
    hadTie,
  }
}

export const addConfidenceRecord = (sessionID: SessionSchema.ID, record: Omit<ConfidenceRecord, "timestamp">): void => {
  const prev = get(sessionID)
  store.set(sessionID, {
    ...prev,
    confidenceHistory: [...prev.confidenceHistory, { ...record, timestamp: new Date() }],
  })
}

export const getConfidenceHistory = (sessionID: SessionSchema.ID): readonly ConfidenceRecord[] => {
  return get(sessionID).confidenceHistory
}

export const getCalibratedConfidence = (sessionID: SessionSchema.ID, toolName: string, predictedConfidence: number): number => {
  const history = getConfidenceHistory(sessionID).filter((r) => r.toolName === toolName)
  if (history.length < 5) return predictedConfidence
  const bins = new Map<number, { successes: number; total: number }>()
  for (const record of history) {
    const bin = Math.round(record.predictedConfidence * 10) / 10
    const current = bins.get(bin) ?? { successes: 0, total: 0 }
    current.total++
    if (record.actualOutcome === "success") current.successes++
    bins.set(bin, current)
  }
  const bin = Math.round(predictedConfidence * 10) / 10
  const calibration = bins.get(bin)
  if (!calibration || calibration.total < 3) return predictedConfidence
  return calibration.successes / calibration.total
}

export const addCausalNode = (sessionID: SessionSchema.ID, node: Omit<CausalNode, "id" | "timestamp">): string => {
  const prev = get(sessionID)
  const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const newNode: CausalNode = {
    ...node,
    id,
    timestamp: new Date(),
  }
  store.set(sessionID, {
    ...prev,
    causalNodes: [...prev.causalNodes, newNode],
  })
  return id
}

export const addCausalEdge = (sessionID: SessionSchema.ID, edge: CausalEdge): void => {
  const prev = get(sessionID)
  store.set(sessionID, {
    ...prev,
    causalEdges: [...prev.causalEdges, edge],
  })
}

export const getCausalGraph = (sessionID: SessionSchema.ID): { nodes: readonly CausalNode[]; edges: readonly CausalEdge[] } => {
  const state = get(sessionID)
  return { nodes: state.causalNodes, edges: state.causalEdges }
}

export const addReasoningLog = (sessionID: SessionSchema.ID, entry: Omit<ReasoningLogEntry, "id" | "timestamp">): void => {
  const prev = get(sessionID)
  const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  store.set(sessionID, {
    ...prev,
    reasoningLog: [...prev.reasoningLog, { ...entry, id, timestamp: new Date() }],
  })
}

export const getReasoningLog = (sessionID: SessionSchema.ID): readonly ReasoningLogEntry[] => {
  return get(sessionID).reasoningLog
}

export const clearReasoningLog = (sessionID: SessionSchema.ID): void => {
  const prev = get(sessionID)
  store.set(sessionID, { ...prev, reasoningLog: [] })
}

export const consumeRiskBudget = (sessionID: SessionSchema.ID, amount: number): boolean => {
  const prev = get(sessionID)
  const remaining = prev.riskBudget.limit - prev.riskBudget.used
  if (amount > remaining) return false
  store.set(sessionID, {
    ...prev,
    riskBudget: { ...prev.riskBudget, used: prev.riskBudget.used + amount },
  })
  return true
}

export const resetRiskBudget = (sessionID: SessionSchema.ID, limit?: number): void => {
  const prev = get(sessionID)
  store.set(sessionID, {
    ...prev,
    riskBudget: { used: 0, limit: limit ?? prev.riskBudget.limit },
  })
}

export const getRiskBudget = (sessionID: SessionSchema.ID): { used: number; limit: number; remaining: number } => {
  const { used, limit } = get(sessionID).riskBudget
  return { used, limit, remaining: limit - used }
}

export const addTemporalGuard = (sessionID: SessionSchema.ID, guard: Omit<TemporalGuard, "id" | "createdAt" | "status">): string => {
  const prev = get(sessionID)
  const id = `guard_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const newGuard: TemporalGuard = {
    ...guard,
    id,
    status: "pending",
    createdAt: new Date(),
  }
  store.set(sessionID, {
    ...prev,
    temporalGuards: [...prev.temporalGuards, newGuard],
  })
  return id
}

export const updateTemporalGuard = (sessionID: SessionSchema.ID, guardIdOrDesc: string, status: TemporalGuard["status"]): void => {
  const prev = get(sessionID)
  const temporalGuards = prev.temporalGuards.map((g) =>
    g.id === guardIdOrDesc || g.description.includes(guardIdOrDesc) || g.formula.includes(guardIdOrDesc)
      ? { ...g, status }
      : g,
  )
  store.set(sessionID, { ...prev, temporalGuards })
}

export const getTemporalGuards = (sessionID: SessionSchema.ID): readonly TemporalGuard[] => {
  return get(sessionID).temporalGuards
}