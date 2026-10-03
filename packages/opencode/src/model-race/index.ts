export * as ModelRace from "./index"

export { options, references } from "./config"
export { Controller } from "./controller"
export { ToolExecutionGate, ToolNotWinnerError, gateTools } from "./gate"
export { stream } from "./runner"
export type {
  Candidate,
  CandidateState,
  LockedWinner,
  ModelRaceCandidateState,
  ModelRacePhase,
  ModelRaceUpdate,
  ModelReference,
  RaceMetrics,
  RaceOptions,
  WinnerReason,
} from "./types"
