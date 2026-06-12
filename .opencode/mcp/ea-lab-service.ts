import { openEaLabDatabase } from "../ea-lab-core/db"
import { searchEvidence, storeEvidence, type StoreEvidenceInput } from "../ea-lab-core/evidence"
import {
  storeExperiment,
  updateExperimentResult,
  type StoreExperimentInput,
  type UpdateExperimentResultInput,
} from "../ea-lab-core/experiments"
import {
  attachExperienceEvidence,
  searchSimilarExperiences,
  storeExperience,
  type SimilarExperienceInput,
  type StoreExperienceInput,
} from "../ea-lab-core/experiences"
import { checkRiskGates, parseRiskGates, type RiskGateCheckInput } from "../ea-lab-core/risk-gates"
import { ensureEaLabSchema, readEaLabMeta } from "../ea-lab-core/schema"
import { ExperimentStages, ExperimentStatuses, OverfitRisks, type ExperimentStage, type ExperimentStatus, type OverfitRisk } from "../ea-lab-core/types"

export function createEaLabService(defaults: { dbPath?: string; riskGatePath: string }) {
  const withDb = <T>(fn: (db: ReturnType<typeof openEaLabDatabase>) => T) => {
    const db = openEaLabDatabase(defaults.dbPath, true)
    try {
      ensureEaLabSchema(db)
      return fn(db)
    } finally {
      db.close(false)
    }
  }

  return {
    async health() {
      return withDb((db) => ({
        ok: true,
        schemaVersion: readEaLabMeta(db, "ea_lab_schema_version"),
      }))
    },

    async storeEvidence(input: StoreEvidenceInput) {
      return withDb((db) => storeEvidence(db, input))
    },

    async searchEvidence(input: { query: string; limit?: number }) {
      return withDb((db) => searchEvidence(db, input.query, input.limit ?? 8))
    },

    async storeExperiment(
      input:
        | StoreExperimentInput
        | {
            title: string
            symbol: string
            timeframe: string
            strategy: string
            hypothesis: string
            implementation_summary?: string
            test_conditions?: Record<string, unknown>
            metrics?: Record<string, unknown>
            result_status?: ExperimentStatus
            stage?: ExperimentStage
            overfit_risk?: OverfitRisk
            hasOutOfSample?: boolean
            hasSpreadSensitivity?: boolean
            hasDemoForward?: boolean
            wantsLiveTrading?: boolean
            wantsLotIncrease?: boolean
            wantsGateRelaxation?: boolean
            usesMartingale?: boolean
            usesGrid?: boolean
            hasHardMaxLoss?: boolean
            optimizedOnSinglePeriod?: boolean
            has_out_of_sample?: boolean
            has_demo_forward?: boolean
            spread_slippage_documented?: boolean
            wants_live_trading?: boolean
            wants_lot_increase?: boolean
            wants_gate_relaxation?: boolean
            uses_martingale?: boolean
            uses_grid?: boolean
            has_hard_max_loss?: boolean
            optimized_on_single_period_only?: boolean
          },
    ) {
      const implementationSummary = input.implementation_summary?.trim() || "No implementation summary provided"
      const testConditionsJSON =
        "test_conditions_json" in input ? input.test_conditions_json : JSON.stringify(input.test_conditions ?? {})
      const metricsJSON = "metrics_json" in input ? input.metrics_json : JSON.stringify(input.metrics ?? {})
      const resultStatus = input.result_status ?? ExperimentStatuses[0]
      const stage = input.stage ?? ExperimentStages[0]
      const overfitRisk = input.overfit_risk ?? OverfitRisks[3]
      await enforceExperimentRiskGates({
        riskGatePath: defaults.riskGatePath,
        currentStatus: undefined,
        currentStage: undefined,
        currentMetricsJSON: undefined,
        nextStatus: resultStatus,
        nextStage: stage,
        nextMetricsJSON: metricsJSON,
        safetyInput: input as ExperimentSafetyInput,
      })
      return withDb((db) =>
        storeExperiment(db, {
          title: input.title,
          symbol: input.symbol,
          timeframe: input.timeframe,
          strategy: input.strategy,
          hypothesis: input.hypothesis,
          implementation_summary: implementationSummary,
          test_conditions_json: testConditionsJSON,
          metrics_json: metricsJSON,
          result_status: resultStatus,
          stage,
          overfit_risk: overfitRisk,
        }),
      )
    },

    async updateExperimentResult(
      input:
        | ({ id: string } & UpdateExperimentResultInput)
        | {
            id: string
            metrics?: Record<string, unknown>
            result_status?: ExperimentStatus
            stage?: ExperimentStage
            overfit_risk?: OverfitRisk
            hasOutOfSample?: boolean
            hasSpreadSensitivity?: boolean
            hasDemoForward?: boolean
            wantsLiveTrading?: boolean
            wantsLotIncrease?: boolean
            wantsGateRelaxation?: boolean
            usesMartingale?: boolean
            usesGrid?: boolean
            hasHardMaxLoss?: boolean
            optimizedOnSinglePeriod?: boolean
            has_out_of_sample?: boolean
            has_demo_forward?: boolean
            spread_slippage_documented?: boolean
            wants_live_trading?: boolean
            wants_lot_increase?: boolean
            wants_gate_relaxation?: boolean
            uses_martingale?: boolean
            uses_grid?: boolean
            has_hard_max_loss?: boolean
            optimized_on_single_period_only?: boolean
          },
    ) {
      const current = withDb((db) =>
        db.query<{ result_status: ExperimentStatus; stage: ExperimentStage; metrics_json: string; overfit_risk: OverfitRisk }, [string]>(
          "select result_status, stage, metrics_json, overfit_risk from experiment where id = ? limit 1",
        ).get(input.id),
      )
      if (!current) throw new Error(`experiment not found: ${input.id}`)
      const metricsJSON = "metrics_json" in input ? input.metrics_json : "metrics" in input ? JSON.stringify(input.metrics ?? {}) : current.metrics_json
      const resultStatus = input.result_status ?? current.result_status
      const stage = "stage" in input && input.stage !== undefined ? input.stage : current.stage
      await enforceExperimentRiskGates({
        riskGatePath: defaults.riskGatePath,
        currentStatus: current.result_status,
        currentStage: current.stage,
        currentMetricsJSON: current.metrics_json,
        nextStatus: resultStatus,
        nextStage: stage,
        nextMetricsJSON: metricsJSON,
        safetyInput: input as ExperimentSafetyInput,
      })
      return withDb((db) =>
        updateExperimentResult(db, input.id, {
          metrics_json: metricsJSON,
          result_status: resultStatus,
          stage,
          overfit_risk: input.overfit_risk ?? current.overfit_risk,
        }),
      )
    },

    async storeExperience(
      input:
        | StoreExperienceInput
        | {
            type: StoreExperienceInput["type"]
            situation: string
            trigger_conditions?: Record<string, unknown>
            trigger_conditions_json?: string
            action_taken: string
            outcome: string
            lesson: string
            reuse_rule: string
            anti_rule: string
            confidence?: StoreExperienceInput["confidence"]
            status?: StoreExperienceInput["status"]
            evidence_ids?: string[]
          },
    ) {
      const triggerConditionsJSON =
        "trigger_conditions_json" in input && input.trigger_conditions_json !== undefined
          ? input.trigger_conditions_json
          : JSON.stringify(("trigger_conditions" in input ? input.trigger_conditions : undefined) ?? {})
      return withDb((db) => {
        const stored = storeExperience(db, {
          type: input.type,
          situation: input.situation,
          trigger_conditions_json: triggerConditionsJSON,
          action_taken: input.action_taken,
          outcome: input.outcome,
          lesson: input.lesson,
          reuse_rule: input.reuse_rule,
          anti_rule: input.anti_rule,
          confidence: input.confidence ?? "medium",
          status: input.status ?? "active",
        })
        if ("evidence_ids" in input) {
          for (const evidenceID of input.evidence_ids ?? []) attachExperienceEvidence(db, stored.id, evidenceID)
        }
        return stored
      })
    },

    async searchSimilarExperiences(input: SimilarExperienceInput) {
      return withDb((db) => searchSimilarExperiences(db, input))
    },

    async checkRiskGates(
      input:
        | RiskGateCheckInput
        | {
            targetType?: string
            targetID?: string
            stage: string
            requestedAction?: string
            metrics?: {
              trade_count?: number
              max_drawdown_percent?: number
            }
            hasOutOfSample?: boolean
            hasSpreadSensitivity?: boolean
            hasDemoForward?: boolean
            wantsLiveTrading?: boolean
            wantsLotIncrease?: boolean
            wantsGateRelaxation?: boolean
            usesMartingale?: boolean
            usesGrid?: boolean
            hasHardMaxLoss?: boolean
            optimizedOnSinglePeriod?: boolean
            has_out_of_sample?: boolean
            has_demo_forward?: boolean
            spread_slippage_documented?: boolean
            wants_live_trading?: boolean
            wants_lot_increase?: boolean
            wants_gate_relaxation?: boolean
            uses_martingale?: boolean
            uses_grid?: boolean
            has_hard_max_loss?: boolean
            optimized_on_single_period_only?: boolean
          },
    ) {
      const targetType = ("targetType" in input ? input.targetType : undefined) ?? "promotion"
      const targetID = ("targetID" in input ? input.targetID : undefined) ?? "unknown"
      const requestedAction = ("requestedAction" in input ? input.requestedAction : undefined) ?? "promote"
      const legacy = input as {
        has_out_of_sample?: boolean
        has_demo_forward?: boolean
        spread_slippage_documented?: boolean
        wants_live_trading?: boolean
        wants_lot_increase?: boolean
        wants_gate_relaxation?: boolean
        uses_martingale?: boolean
        uses_grid?: boolean
        has_hard_max_loss?: boolean
        optimized_on_single_period_only?: boolean
      }
      return checkRiskGates(await parseRiskGates(defaults.riskGatePath), {
        targetType,
        targetID,
        stage: input.stage,
        requestedAction,
        metrics: input.metrics ?? {},
        hasOutOfSample: "hasOutOfSample" in input ? (input.hasOutOfSample ?? false) : (legacy.has_out_of_sample ?? false),
        hasSpreadSensitivity:
          "hasSpreadSensitivity" in input
            ? (input.hasSpreadSensitivity ?? false)
            : (legacy.spread_slippage_documented ?? false),
        hasDemoForward: "hasDemoForward" in input ? (input.hasDemoForward ?? false) : (legacy.has_demo_forward ?? false),
        wantsLiveTrading: "wantsLiveTrading" in input ? (input.wantsLiveTrading ?? false) : (legacy.wants_live_trading ?? false),
        wantsLotIncrease: "wantsLotIncrease" in input ? (input.wantsLotIncrease ?? false) : (legacy.wants_lot_increase ?? false),
        wantsGateRelaxation:
          "wantsGateRelaxation" in input ? (input.wantsGateRelaxation ?? false) : (legacy.wants_gate_relaxation ?? false),
        usesMartingale: "usesMartingale" in input ? (input.usesMartingale ?? false) : (legacy.uses_martingale ?? false),
        usesGrid: "usesGrid" in input ? (input.usesGrid ?? false) : (legacy.uses_grid ?? false),
        hasHardMaxLoss: "hasHardMaxLoss" in input ? (input.hasHardMaxLoss ?? false) : (legacy.has_hard_max_loss ?? false),
        optimizedOnSinglePeriod:
          "optimizedOnSinglePeriod" in input
            ? (input.optimizedOnSinglePeriod ?? false)
            : (legacy.optimized_on_single_period_only ?? false),
      })
    },
  }
}

export type EaLabService = ReturnType<typeof createEaLabService>

type ExperimentSafetyInput = {
  hasOutOfSample?: boolean
  hasSpreadSensitivity?: boolean
  hasDemoForward?: boolean
  wantsLiveTrading?: boolean
  wantsLotIncrease?: boolean
  wantsGateRelaxation?: boolean
  usesMartingale?: boolean
  usesGrid?: boolean
  hasHardMaxLoss?: boolean
  optimizedOnSinglePeriod?: boolean
  has_out_of_sample?: boolean
  has_demo_forward?: boolean
  spread_slippage_documented?: boolean
  wants_live_trading?: boolean
  wants_lot_increase?: boolean
  wants_gate_relaxation?: boolean
  uses_martingale?: boolean
  uses_grid?: boolean
  has_hard_max_loss?: boolean
  optimized_on_single_period_only?: boolean
}

async function enforceExperimentRiskGates(input: {
  riskGatePath: string
  currentStatus: ExperimentStatus | undefined
  currentStage: ExperimentStage | undefined
  currentMetricsJSON: string | undefined
  nextStatus: ExperimentStatus
  nextStage: ExperimentStage
  nextMetricsJSON: string
  safetyInput: ExperimentSafetyInput
}) {
  const promotionTransition = input.nextStatus === "promoted" && input.currentStatus !== "promoted"
  const liveTransition = isLiveStage(input.nextStage) && !isLiveStage(input.currentStage)
  if (!promotionTransition && !liveTransition) return
  const nextMetrics = readMetricsJson(input.nextMetricsJSON) ?? readMetricsJson(input.currentMetricsJSON)
  const tradeCount = readMetricNumber(nextMetrics?.trade_count)
  const maxDrawdownPercent = readMetricNumber(nextMetrics?.max_drawdown_percent)
  const violations = [
    tradeCount === undefined
      ? { name: "trade_count_required", severity: "hard" as const, reason: "promotion/live transition requires numeric trade_count" }
      : undefined,
    maxDrawdownPercent === undefined
      ? {
          name: "max_drawdown_percent_required",
          severity: "hard" as const,
          reason: "promotion/live transition requires numeric max_drawdown_percent",
        }
      : undefined,
  ].filter((item): item is { name: string; severity: "hard"; reason: string } => item !== undefined)
  const wantsLiveTrading = liveTransition || readSafetyBoolean(input.safetyInput.wantsLiveTrading, input.safetyInput.wants_live_trading)
  const result = checkRiskGates(await parseRiskGates(input.riskGatePath), {
    targetType: "promotion",
    targetID: "experiment",
    stage: input.nextStage,
    requestedAction: promotionTransition || liveTransition ? "promote" : "update",
    metrics: {
      trade_count: tradeCount,
      max_drawdown_percent: maxDrawdownPercent,
    },
    hasOutOfSample: readSafetyBoolean(input.safetyInput.hasOutOfSample, input.safetyInput.has_out_of_sample),
    hasSpreadSensitivity: readSafetyBoolean(input.safetyInput.hasSpreadSensitivity, input.safetyInput.spread_slippage_documented),
    hasDemoForward: readSafetyBoolean(input.safetyInput.hasDemoForward, input.safetyInput.has_demo_forward),
    wantsLiveTrading,
    wantsLotIncrease: readSafetyBoolean(input.safetyInput.wantsLotIncrease, input.safetyInput.wants_lot_increase),
    wantsGateRelaxation: readSafetyBoolean(input.safetyInput.wantsGateRelaxation, input.safetyInput.wants_gate_relaxation),
    usesMartingale: readSafetyBoolean(input.safetyInput.usesMartingale, input.safetyInput.uses_martingale),
    usesGrid: readSafetyBoolean(input.safetyInput.usesGrid, input.safetyInput.uses_grid),
    hasHardMaxLoss: readSafetyBoolean(input.safetyInput.hasHardMaxLoss, input.safetyInput.has_hard_max_loss),
    optimizedOnSinglePeriod: readSafetyBoolean(
      input.safetyInput.optimizedOnSinglePeriod,
      input.safetyInput.optimized_on_single_period_only,
    ),
  })
  const allViolations = [...violations, ...result.violations]
  if (!allViolations.length) return
  throw new Error(`risk gate blocked experiment transition: ${allViolations.map((item) => item.name).join(", ")}`)
}

function isLiveStage(stage: ExperimentStage | undefined) {
  return stage === "micro_live" || stage === "limited_live"
}

function readSafetyBoolean(primary: boolean | undefined, legacy: boolean | undefined) {
  return primary ?? legacy ?? false
}

function readMetricsJson(input: string | undefined) {
  if (!input?.trim()) return undefined
  const decoded = JSON.parse(input) as unknown
  return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? (decoded as Record<string, unknown>) : undefined
}

function readMetricNumber(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}
