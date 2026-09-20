import { Effect } from "effect"
import type { Candidate, ModelRaceUpdate, RaceOptions } from "./types"

function model(candidate: Candidate | ModelRaceUpdate["leader"] | ModelRaceUpdate["winner"]) {
  if (!candidate) return undefined
  return `${candidate.providerID}/${candidate.modelID}`
}

function summary(update: ModelRaceUpdate) {
  return update.candidates
    .map(
      (candidate) =>
        `${candidate.providerID}/${candidate.modelID}:${candidate.state}:ttft=${candidate.ttft ?? ""}:tps=${candidate.tokensPerSecond ?? ""}`,
    )
    .join(",")
}

export function started(raceID: string, candidates: Candidate[], options: RaceOptions, snapshot: ModelRaceUpdate) {
  return Effect.logInfo("model race started", {
    "race.id": raceID,
    "candidate.count": candidates.length,
    candidates: candidates.map((candidate) => candidate.id).join(","),
    "strategy.firstToken": options.strategy.firstToken,
    "strategy.throughput": options.strategy.throughput,
    "strategy.toolCall": options.strategy.toolCall,
    "strategy.switch": options.switch.enabled,
    "throughput.warmupTokens": options.throughput.warmupTokens,
    "throughput.measurementWindowMs": options.throughput.measurementWindowMs,
    "race.startedAt": snapshot.startedAt,
  })
}

export function candidateStarted(raceID: string, candidate: Candidate) {
  return Effect.logInfo("model race candidate started", {
    "race.id": raceID,
    candidate: candidate.id,
  })
}

export function firstToken(raceID: string, candidate: Candidate, ttft: number) {
  return Effect.logInfo("model race candidate first token", {
    "race.id": raceID,
    candidate: candidate.id,
    ttft,
  })
}

export function throughput(raceID: string, candidate: Candidate, tokensPerSecond: number, tokenCount: number) {
  return Effect.logDebug("model race throughput measured", {
    "race.id": raceID,
    candidate: candidate.id,
    tokensPerSecond,
    tokenCount,
  })
}

export function leaderSwitched(
  raceID: string,
  from: Candidate | undefined,
  to: Candidate | undefined,
  update: ModelRaceUpdate,
) {
  return Effect.logInfo("model race leader switched", {
    "race.id": raceID,
    from: from?.id,
    to: to?.id,
    candidates: summary(update),
  })
}

export function toolCallDetected(raceID: string, candidate: Candidate, toolCallAt: number) {
  return Effect.logInfo("model race tool call detected", {
    "race.id": raceID,
    candidate: candidate.id,
    toolCallAt,
  })
}

export function winnerLocked(update: ModelRaceUpdate) {
  return Effect.logInfo("model race winner locked", {
    "race.id": update.raceID,
    winner: model(update.winner),
    reason: update.reason,
    "race.duration": update.updatedAt - update.startedAt,
    candidates: summary(update),
  })
}

export function completed(update: ModelRaceUpdate) {
  return Effect.logInfo("model race completed", {
    "race.id": update.raceID,
    winner: model(update.winner),
    reason: update.reason,
    "race.duration": update.updatedAt - update.startedAt,
    "candidate.count": update.candidates.length,
    candidates: summary(update),
  })
}

export function candidateFailed(raceID: string, candidate: Candidate, error: unknown) {
  return Effect.logWarning("model race candidate failed", {
    "race.id": raceID,
    candidate: candidate.id,
    error: error instanceof Error ? error.message : String(error),
  })
}

export function candidateCancelled(raceID: string, candidate: Candidate) {
  return Effect.logDebug("model race candidate cancelled", {
    "race.id": raceID,
    candidate: candidate.id,
  })
}

export function allFailed(raceID: string, error: unknown) {
  return Effect.logError("model race all candidates failed", {
    "race.id": raceID,
    error: error instanceof Error ? error.message : String(error),
  })
}

export * as ModelRaceLog from "./log"
