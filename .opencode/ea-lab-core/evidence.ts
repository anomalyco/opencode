import { Database } from "bun:sqlite"
import { EvidenceTypes, type EvidenceRow, type EvidenceType } from "./types"

export type StoreEvidenceInput = {
  evidence_type: EvidenceType
  uri?: string
  file_path?: string
  commit_hash?: string
  message_id?: string
  experiment_id?: string
  description: string
  checksum?: string
}

export function storeEvidence(db: Database, input: StoreEvidenceInput) {
  if (!EvidenceTypes.includes(input.evidence_type)) throw new Error("invalid evidence_type")
  if (![input.uri, input.file_path, input.commit_hash, input.message_id, input.experiment_id].some((value) => value?.trim())) {
    throw new Error("evidence requires at least one locator")
  }
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  db.query(
    "insert into evidence (id, evidence_type, uri, file_path, commit_hash, message_id, experiment_id, description, created_at, checksum) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    input.evidence_type,
    normalize(input.uri),
    normalize(input.file_path),
    normalize(input.commit_hash),
    normalize(input.message_id),
    normalize(input.experiment_id),
    requireText(input.description, "description"),
    createdAt,
    normalize(input.checksum),
  )
  return db.query<EvidenceRow, [string]>("select * from evidence where id = ? limit 1").get(id)!
}

export function searchEvidence(db: Database, query: string, limit: number) {
  const rows = db
    .query<EvidenceRow, [string, number]>(
      "select evidence.* from evidence_fts join evidence on evidence_fts.rowid = evidence.rowid where evidence_fts match ? order by bm25(evidence_fts), evidence.created_at desc limit ?",
    )
    .all(requireText(query, "query"), clampLimit(limit))
  return { rows }
}

function normalize(input: string | undefined) {
  const value = input?.trim()
  return value ? value : null
}

function requireText(input: string, field: string) {
  const value = input.trim()
  if (!value) throw new Error(`${field} must not be empty`)
  return value
}

function clampLimit(input: number) {
  return Math.max(1, Math.min(Math.floor(input), 20))
}
