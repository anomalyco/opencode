import type { LLMEvent } from "@opencode-ai/llm"

export type ModelReference = {
  id: string
  providerID: string
  modelID: string
}

export type Candidate = ModelReference & {
  label: string
}

export type WinnerReason = "first-token" | "throughput" | "tool-call" | "completed" | "fallback"

export type RaceOptions = {
  strategy: {
    firstToken: boolean
    throughput: boolean
    toolCall: boolean
  }
  throughput: {
    warmupTokens: number
    measurementWindowMs: number
  }
  switch: {
    enabled: boolean
  }
}

export type CandidateState = {
  candidate: Candidate
  startedAt: number
  firstTokenAt?: number
  finishedAt?: number
  tokenCount: number
  measuredWarmupTokens: number
  measurementStartedAt?: number
  measurementTokens: number
  tokensPerSecond?: number
  toolCallAt?: number
  events: LLMEvent[]
  failed: boolean
  cancelled: boolean
  completed: boolean
}

export type LockedWinner = {
  candidate: Candidate
  reason: WinnerReason
}

export type RaceMetrics = {
  candidate: Candidate
  ttft?: number
  tokenCount: number
  tokensPerSecond?: number
  toolCallAt?: number
  winner?: boolean
  winnerReason?: WinnerReason
  failed: boolean
}

export type ModelRacePhase = "dispatching" | "waiting-first-token" | "measuring" | "locked" | "completed" | "failed"
export type ModelRaceCandidateState =
  | "pending"
  | "streaming"
  | "leader"
  | "winner"
  | "failed"
  | "cancelled"
  | "completed"

export type ModelRaceUpdate = {
  raceID: string
  phase: ModelRacePhase
  candidates: Array<{
    providerID: string
    modelID: string
    state: ModelRaceCandidateState
    ttft?: number
    tokenCount: number
    tokensPerSecond?: number
    toolCallAt?: number
  }>
  leader?: {
    providerID: string
    modelID: string
  }
  winner?: {
    providerID: string
    modelID: string
  }
  reason?: WinnerReason
  startedAt: number
  updatedAt: number
}
