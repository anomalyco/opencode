import { Database } from "bun:sqlite"
import { redactEaLabJson, redactEaLabText } from "./redaction"
import {
  ConfidenceLevels,
  ExperienceTypes,
  MemoryStatuses,
  type ConfidenceLevel,
  type ExperienceRow,
  type ExperienceType,
  type MemoryStatus,
} from "./types"

export type StoreExperienceInput = {
  type: ExperienceType
  situation: string
  trigger_conditions_json: string
  action_taken: string
  outcome: string
  lesson: string
  reuse_rule: string
  anti_rule: string
  confidence: ConfidenceLevel
  status: MemoryStatus
  last_verified_at?: number
  expires_at?: number
}

export type SimilarExperienceInput = {
  query: string
  symbol?: string
  strategy?: string
  timeframe?: string
  limit?: number
}

export type SimilarExperienceRow = ExperienceRow & {
  evidence_ids: string[]
}

export function storeExperience(db: Database, input: StoreExperienceInput) {
  if (!ExperienceTypes.includes(input.type)) throw new Error("invalid experience type")
  if (!ConfidenceLevels.includes(input.confidence)) throw new Error("invalid confidence")
  if (!MemoryStatuses.includes(input.status)) throw new Error("invalid status")
  const antiRule = requireText(input.anti_rule, "anti_rule")
  const reuseRule = requireText(input.reuse_rule, "reuse_rule")
  const id = crypto.randomUUID()
  const now = Date.now()
  db.query(
    "insert into experience (id, type, situation, trigger_conditions_json, action_taken, outcome, lesson, reuse_rule, anti_rule, confidence, status, last_verified_at, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    input.type,
    redactEaLabText(requireText(input.situation, "situation")).text,
    redactEaLabJson(input.trigger_conditions_json, "trigger_conditions_json"),
    redactEaLabText(requireText(input.action_taken, "action_taken")).text,
    redactEaLabText(requireText(input.outcome, "outcome")).text,
    redactEaLabText(requireText(input.lesson, "lesson")).text,
    redactEaLabText(reuseRule).text,
    redactEaLabText(antiRule).text,
    input.confidence,
    input.status,
    input.last_verified_at ?? null,
    input.expires_at ?? null,
    now,
    now,
  )
  return db.query<ExperienceRow, [string]>("select * from experience where id = ? limit 1").get(id)!
}

export function attachExperienceEvidence(db: Database, experienceID: string, evidenceID: string) {
  db.query("insert into experience_evidence (experience_id, evidence_id) values (?, ?) on conflict do nothing").run(
    requireText(experienceID, "experienceID"),
    requireText(evidenceID, "evidenceID"),
  )
  return { experienceID, evidenceID }
}

export function searchSimilarExperiences(db: Database, input: SimilarExperienceInput) {
  const query = buildFtsQuery(input)
  if (!query) return { rows: [] }
  const rows = db
    .query<ExperienceRow, [string, number]>(
      "select experience.* from experience_fts join experience on experience_fts.rowid = experience.rowid where experience_fts match ? order by case experience.status when 'active' then 0 when 'draft' then 1 when 'stale' then 2 when 'contradicted' then 3 else 4 end, bm25(experience_fts), experience.updated_at desc limit ?",
    )
    .all(query, Math.max(1, Math.min(Math.floor(input.limit ?? 5), 20)))
  return {
    rows: rows.map((row) => ({
      ...row,
      evidence_ids: db
        .query<{ evidence_id: string }, [string]>("select evidence_id from experience_evidence where experience_id = ? order by evidence_id")
        .all(row.id)
        .map((item) => item.evidence_id),
    })),
  }
}

function buildFtsQuery(input: SimilarExperienceInput) {
  return [input.query, input.symbol, input.strategy, input.timeframe]
    .filter((value): value is string => !!value?.trim())
    .flatMap((value) => value.split(/[^A-Za-z0-9_]+/))
    .map((value) => value.trim())
    .filter((value) => value.length > 1)
    .join(" OR ")
}

function requireText(input: string, field: string) {
  const value = input.trim()
  if (!value) throw new Error(`${field} must not be empty`)
  return value
}
