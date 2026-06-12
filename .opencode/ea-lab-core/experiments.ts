import { Database } from "bun:sqlite"
import { redactEaLabJson, redactEaLabText } from "./redaction"
import {
  ExperimentStages,
  ExperimentStatuses,
  OverfitRisks,
  type ExperimentRow,
  type ExperimentStage,
  type ExperimentStatus,
  type OverfitRisk,
} from "./types"

export type StoreExperimentInput = {
  title: string
  symbol: string
  timeframe: string
  strategy: string
  hypothesis: string
  implementation_summary: string
  test_conditions_json: string
  metrics_json: string
  result_status: ExperimentStatus
  stage: ExperimentStage
  overfit_risk: OverfitRisk
}

export type UpdateExperimentResultInput = {
  metrics_json: string
  result_status: ExperimentStatus
  stage?: ExperimentStage
  overfit_risk: OverfitRisk
}

export function storeExperiment(db: Database, input: StoreExperimentInput) {
  validateExperimentEnums(input)
  const id = crypto.randomUUID()
  const now = Date.now()
  db.query(
    "insert into experiment (id, title, symbol, timeframe, strategy, hypothesis, implementation_summary, test_conditions_json, metrics_json, result_status, stage, overfit_risk, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    redactEaLabText(requireText(input.title, "title")).text,
    redactEaLabText(requireText(input.symbol, "symbol")).text,
    redactEaLabText(requireText(input.timeframe, "timeframe")).text,
    redactEaLabText(requireText(input.strategy, "strategy")).text,
    redactEaLabText(requireText(input.hypothesis, "hypothesis")).text,
    redactEaLabText(requireText(input.implementation_summary, "implementation_summary")).text,
    redactEaLabJson(input.test_conditions_json, "test_conditions_json"),
    redactEaLabJson(input.metrics_json, "metrics_json"),
    input.result_status,
    input.stage,
    input.overfit_risk,
    now,
    now,
  )
  return getExperiment(db, id)
}

export function updateExperimentResult(db: Database, id: string, input: UpdateExperimentResultInput) {
  if (!ExperimentStatuses.includes(input.result_status)) throw new Error("invalid result_status")
  if (!OverfitRisks.includes(input.overfit_risk)) throw new Error("invalid overfit_risk")
  if (input.stage !== undefined && !ExperimentStages.includes(input.stage)) throw new Error("invalid stage")
  db.query("update experiment set metrics_json = ?, result_status = ?, stage = coalesce(?, stage), overfit_risk = ?, updated_at = ? where id = ?").run(
    redactEaLabJson(input.metrics_json, "metrics_json"),
    input.result_status,
    input.stage ?? null,
    input.overfit_risk,
    Date.now(),
    requireText(id, "id"),
  )
  return getExperiment(db, id)
}

function getExperiment(db: Database, id: string) {
  const row = db.query<ExperimentRow, [string]>("select * from experiment where id = ? limit 1").get(id)
  if (!row) throw new Error(`experiment not found: ${id}`)
  return row
}

function validateExperimentEnums(input: StoreExperimentInput) {
  if (!ExperimentStatuses.includes(input.result_status)) throw new Error("invalid result_status")
  if (!ExperimentStages.includes(input.stage)) throw new Error("invalid stage")
  if (!OverfitRisks.includes(input.overfit_risk)) throw new Error("invalid overfit_risk")
}

function requireText(input: string, field: string) {
  const value = input.trim()
  if (!value) throw new Error(`${field} must not be empty`)
  return value
}
