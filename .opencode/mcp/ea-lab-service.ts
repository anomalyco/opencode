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
          },
    ) {
      return withDb((db) =>
        storeExperiment(db, {
          title: input.title,
          symbol: input.symbol,
          timeframe: input.timeframe,
          strategy: input.strategy,
          hypothesis: input.hypothesis,
          implementation_summary:
            "implementation_summary" in input
              ? (input.implementation_summary?.trim() || "No implementation summary provided")
              : input.implementation_summary,
          test_conditions_json:
            "test_conditions_json" in input ? input.test_conditions_json : JSON.stringify(input.test_conditions ?? {}),
          metrics_json: "metrics_json" in input ? input.metrics_json : JSON.stringify(input.metrics ?? {}),
          result_status: "result_status" in input ? input.result_status ?? ExperimentStatuses[0] : input.result_status,
          stage: "stage" in input ? input.stage ?? ExperimentStages[0] : input.stage,
          overfit_risk: "overfit_risk" in input ? input.overfit_risk ?? OverfitRisks[3] : input.overfit_risk,
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
          },
    ) {
      return withDb((db) => {
        const current = db.query<{ result_status: ExperimentStatus; overfit_risk: OverfitRisk }, [string]>(
          "select result_status, overfit_risk from experiment where id = ? limit 1",
        ).get(input.id)
        if (!current) throw new Error(`experiment not found: ${input.id}`)
        return updateExperimentResult(db, input.id, {
          metrics_json: "metrics_json" in input ? input.metrics_json : JSON.stringify(input.metrics ?? {}),
          result_status: input.result_status ?? current.result_status,
          stage: "stage" in input ? input.stage : undefined,
          overfit_risk: input.overfit_risk ?? current.overfit_risk,
        })
      })
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
      return withDb((db) => {
        const stored = storeExperience(db, {
          type: input.type,
          situation: input.situation,
          trigger_conditions_json:
            "trigger_conditions_json" in input && input.trigger_conditions_json !== undefined
              ? input.trigger_conditions_json
              : JSON.stringify(input.trigger_conditions ?? {}),
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
            has_out_of_sample?: boolean
            spread_slippage_documented?: boolean
          },
    ) {
      return checkRiskGates(await parseRiskGates(defaults.riskGatePath), {
        targetType: "targetType" in input ? (input.targetType ?? "promotion") : input.targetType,
        targetID: "targetID" in input ? (input.targetID ?? "unknown") : input.targetID,
        stage: input.stage,
        requestedAction: "requestedAction" in input ? (input.requestedAction ?? "promote") : input.requestedAction,
        metrics: input.metrics ?? {},
        hasOutOfSample: "hasOutOfSample" in input ? (input.hasOutOfSample ?? false) : (input.has_out_of_sample ?? false),
        hasSpreadSensitivity:
          "hasSpreadSensitivity" in input
            ? (input.hasSpreadSensitivity ?? false)
            : (input.spread_slippage_documented ?? false),
      })
    },
  }
}

export type EaLabService = ReturnType<typeof createEaLabService>
