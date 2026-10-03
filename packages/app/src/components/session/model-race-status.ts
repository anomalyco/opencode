export type ModelRaceStatus = {
  sessionID: string
  messageID: string
  raceID: string
  phase: "dispatching" | "waiting-first-token" | "measuring" | "locked" | "completed" | "failed"
  candidates: Array<{
    providerID: string
    modelID: string
    state: "pending" | "streaming" | "leader" | "winner" | "failed" | "cancelled" | "completed"
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
  reason?: "first-token" | "throughput" | "tool-call" | "completed" | "fallback"
  startedAt: number
  updatedAt: number
}

export function raceModelID(model: ModelRaceStatus["leader"] | ModelRaceStatus["winner"]) {
  if (!model) return undefined
  return `${model.providerID}/${model.modelID}`
}

export function raceActive(status: ModelRaceStatus) {
  return status.phase === "dispatching" || status.phase === "waiting-first-token" || status.phase === "measuring"
}

export function latestModelRace(races: Record<string, ModelRaceStatus>, sessionID?: string) {
  if (!sessionID) return undefined
  return Object.values(races)
    .filter((race) => race?.sessionID === sessionID)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0]
}
