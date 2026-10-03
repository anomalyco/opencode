import type { LLMEvent } from "@opencode-ai/llm"
import {
  isFinished,
  isFirstToken,
  isMeaningfullyFaster,
  isProviderError,
  isToolCall,
  tokenWeight,
  tokensPerSecond,
} from "./scorer"
import type {
  Candidate,
  CandidateState,
  LockedWinner,
  ModelRaceCandidateState,
  ModelRaceUpdate,
  RaceMetrics,
  RaceOptions,
  WinnerReason,
} from "./types"

export type Observation = {
  leader?: LockedWinner
  switchedFrom?: Candidate
}

export class Controller {
  readonly #states = new Map<string, CandidateState>()
  readonly #startedAt: number
  #leaderID: string | undefined
  #winnerID: string | undefined
  #winnerReason: WinnerReason | undefined
  #failed = false

  constructor(
    candidates: Candidate[],
    readonly options: RaceOptions,
    now = Date.now(),
  ) {
    this.#startedAt = now
    for (const candidate of candidates) {
      this.#states.set(candidate.id, {
        candidate,
        startedAt: now,
        tokenCount: 0,
        measuredWarmupTokens: 0,
        measurementTokens: 0,
        events: [],
        failed: false,
        cancelled: false,
        completed: false,
      })
    }
  }

  observe(candidateID: string, event: LLMEvent, now = Date.now()): Observation {
    const state = this.#states.get(candidateID)
    if (!state || state.failed || this.#winnerID) return {}

    state.events.push(event)
    if (isProviderError(event)) {
      this.fail(candidateID)
      return {}
    }

    const weight = tokenWeight(event)
    if (weight > 0) {
      state.tokenCount += weight
      if (state.firstTokenAt === undefined) state.firstTokenAt = now
      this.#measure(state, weight, now)
    }

    if (this.options.strategy.firstToken && this.#leaderID === undefined && isFirstToken(event)) {
      this.#leaderID = candidateID
    }

    if (this.options.strategy.toolCall && isToolCall(event)) {
      state.toolCallAt = now
      this.#lock(candidateID, "tool-call")
      return { leader: this.winner() }
    }

    if (isFinished(event)) {
      state.completed = true
      state.finishedAt = now
      this.#lock(candidateID, "completed")
      return { leader: this.winner() }
    }

    const before = this.leader()
    this.#reselect()
    const after = this.leader()
    return before?.id !== after?.id ? { switchedFrom: before } : {}
  }

  fail(candidateID: string) {
    const state = this.#states.get(candidateID)
    if (!state || state.failed || this.#winnerID) return
    state.failed = true
    if (this.#leaderID === candidateID) this.#leaderID = undefined
    this.#reselect()
    if (this.allFailed()) this.#failed = true
  }

  cancel(candidateID: string) {
    const state = this.#states.get(candidateID)
    if (!state || state.failed || state.completed || this.#winnerID) return
    state.cancelled = true
    if (this.#leaderID === candidateID) this.#leaderID = undefined
    this.#reselect()
  }

  leader() {
    if (!this.#leaderID) return undefined
    return this.#states.get(this.#leaderID)?.candidate
  }

  winner() {
    if (!this.#winnerID || !this.#winnerReason) return undefined
    const state = this.#states.get(this.#winnerID)
    if (!state) return undefined
    return { candidate: state.candidate, reason: this.#winnerReason }
  }

  state(candidateID: string) {
    return this.#states.get(candidateID)
  }

  metrics(): RaceMetrics[] {
    return [...this.#states.values()].map((state) => ({
      candidate: state.candidate,
      ttft: state.firstTokenAt === undefined ? undefined : state.firstTokenAt - state.startedAt,
      tokenCount: state.tokenCount,
      tokensPerSecond: state.tokensPerSecond,
      toolCallAt: state.toolCallAt,
      winner: state.candidate.id === this.#winnerID,
      winnerReason: state.candidate.id === this.#winnerID ? this.#winnerReason : undefined,
      failed: state.failed,
    }))
  }

  snapshot(raceID: string, now = Date.now()): ModelRaceUpdate {
    const winner = this.winner()
    const leader = this.leader()
    return {
      raceID,
      phase: this.#failed
        ? "failed"
        : winner
          ? winner.reason === "completed"
            ? "completed"
            : "locked"
          : leader
            ? "measuring"
            : [...this.#states.values()].some((state) => state.events.length > 0)
              ? "waiting-first-token"
              : "dispatching",
      candidates: [...this.#states.values()].map((state) => ({
        providerID: state.candidate.providerID,
        modelID: state.candidate.modelID,
        state: this.#stateName(state),
        ttft: state.firstTokenAt === undefined ? undefined : state.firstTokenAt - state.startedAt,
        tokenCount: state.tokenCount,
        tokensPerSecond: state.tokensPerSecond,
        toolCallAt: state.toolCallAt,
      })),
      leader: leader ? { providerID: leader.providerID, modelID: leader.modelID } : undefined,
      winner: winner ? { providerID: winner.candidate.providerID, modelID: winner.candidate.modelID } : undefined,
      reason: winner?.reason,
      startedAt: this.#startedAt,
      updatedAt: now,
    }
  }

  allFailed() {
    return [...this.#states.values()].every((state) => state.failed)
  }

  #measure(state: CandidateState, weight: number, now: number) {
    if (state.measuredWarmupTokens < this.options.throughput.warmupTokens) {
      state.measuredWarmupTokens += weight
      if (state.measuredWarmupTokens >= this.options.throughput.warmupTokens) {
        state.measurementStartedAt = now
        state.measurementTokens = 0
      }
      return
    }

    state.measurementTokens += weight
    if (state.measurementStartedAt === undefined) state.measurementStartedAt = now
    const duration = now - state.measurementStartedAt
    if (duration < this.options.throughput.measurementWindowMs) return
    state.tokensPerSecond = tokensPerSecond(state.measurementTokens, duration)
    state.measurementStartedAt = now
    state.measurementTokens = 0
  }

  #reselect() {
    if (!this.options.strategy.throughput || !this.options.switch.enabled || this.#winnerID) return
    const current = this.#leaderID ? this.#states.get(this.#leaderID) : undefined
    const candidates = [...this.#states.values()].filter((state) => !state.failed && !state.completed)
    if (!current) {
      const fallback = candidates
        .filter((state) => state.firstTokenAt !== undefined)
        .toSorted((a, b) => (a.firstTokenAt ?? 0) - (b.firstTokenAt ?? 0))[0]
      if (fallback) this.#leaderID = fallback.candidate.id
    }
    const challenger = candidates
      .filter((state) => state.tokensPerSecond !== undefined)
      .toSorted((a, b) => (b.tokensPerSecond ?? 0) - (a.tokensPerSecond ?? 0))[0]

    if (!challenger) return
    if (
      !this.leader() ||
      current?.failed ||
      isMeaningfullyFaster(current?.tokensPerSecond, challenger.tokensPerSecond)
    ) {
      this.#leaderID = challenger.candidate.id
      return
    }
  }

  #lock(candidateID: string, reason: WinnerReason) {
    if (this.#winnerID) return
    this.#winnerID = candidateID
    this.#leaderID = candidateID
    this.#winnerReason = reason
  }

  #stateName(state: CandidateState): ModelRaceCandidateState {
    if (state.candidate.id === this.#winnerID) return "winner"
    if (state.failed) return "failed"
    if (state.cancelled) return "cancelled"
    if (state.candidate.id === this.#leaderID) return "leader"
    if (state.completed) return "completed"
    if (state.events.length > 0) return "streaming"
    return "pending"
  }
}
