export type ModelRaceState = {
  sessionID: string
  messageID: string
  raceID: string
  phase: string
  candidates: Array<{
    providerID: string
    modelID: string
    state: string
    ttft?: number
    tokenCount: number
    tokensPerSecond?: number
    toolCallAt?: number
  }>
  leader?: { providerID: string; modelID: string }
  winner?: { providerID: string; modelID: string }
  reason?: string
  startedAt: number
  updatedAt: number
}

export function latestRace(races: Record<string, ModelRaceState>, sessionID?: string) {
  if (!sessionID) return undefined
  return Object.values(races)
    .filter((race) => race.sessionID === sessionID)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0]
}

export function messageRace(races: Record<string, ModelRaceState>, messageID: string) {
  return races[messageID]
}

export function raceModel(race?: ModelRaceState) {
  return race?.winner ?? race?.leader
}

export function raceModelID(race?: ModelRaceState) {
  const model = raceModel(race)
  return model ? `${model.providerID}/${model.modelID}` : undefined
}

export function raceActive(race?: ModelRaceState) {
  return race?.phase === "dispatching" || race?.phase === "waiting-first-token" || race?.phase === "measuring"
}
