export * as DatabaseRepair from "./repair"

import { Database as BunDatabase } from "bun:sqlite"
import type { RepairOperation, RepairPlan } from "./health"
import { generateDoctorReport } from "./health"

export interface BackupInfo {
  path: string
  createdAt: string
  originalPath: string
}

export interface ApplyResult {
  success: boolean
  backup: BackupInfo
  operationsApplied: number
  operationsFailed: number
  postCheckIssues: number
  error?: string
}

export async function createBackup(dbPath: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backup = {
    path: `${dbPath}.backup.${timestamp}`,
    createdAt: new Date().toISOString(),
    originalPath: dbPath,
  }

  const db = new BunDatabase(dbPath)
  try {
    db.exec(`VACUUM main INTO '${backup.path.replaceAll("'", "''")}'`)
  } finally {
    db.close()
  }
  return backup
}

export async function applyRepairPlan(plan: RepairPlan) {
  if (plan.exitCode === 2) {
    return failedResult(plan.dbPath, "Cannot apply repairs to an unsupported or unreadable database")
  }

  if (plan.operations.length === 0) {
    return {
      success: true,
      backup: { path: "", createdAt: "", originalPath: plan.dbPath },
      operationsApplied: 0,
      operationsFailed: 0,
      postCheckIssues: 0,
    } satisfies ApplyResult
  }

  const backup = await createBackup(plan.dbPath)
  const db = new BunDatabase(plan.dbPath)
  try {
    db.exec("BEGIN IMMEDIATE TRANSACTION")
    try {
      plan.operations.forEach((operation) => applyOperation(db, operation))
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      return {
        success: false,
        backup,
        operationsApplied: 0,
        operationsFailed: 1,
        postCheckIssues: -1,
        error: error instanceof Error ? error.message : "Unknown repair failure",
      } satisfies ApplyResult
    }
  } finally {
    db.close()
  }

  const postCheck = await generateDoctorReport(plan.dbPath)
  if (postCheck.exitCode === 2) {
    return {
      success: false,
      backup,
      operationsApplied: plan.operations.length,
      operationsFailed: 1,
      postCheckIssues: -1,
      error: "Post-check failed after repair commit",
    } satisfies ApplyResult
  }

  return {
    success: true,
    backup,
    operationsApplied: plan.operations.length,
    operationsFailed: 0,
    postCheckIssues: postCheck.issues.filter((issue) => issue.severity === "error").length,
  } satisfies ApplyResult
}

function applyOperation(db: BunDatabase, operation: RepairOperation) {
  if (operation.issueCode === "part_legacy_id_prefix") return applyPartIDRepair(db, operation)
  if (operation.issueCode === "assistant_message_missing_agent") return applyAssistantAgentRepair(db, operation)
  if (operation.issueCode.startsWith("session_") && operation.issueCode.endsWith("_missing")) return applySessionMetadataRepair(db, operation)
  throw new Error(`Unsupported repair operation: ${operation.issueCode}`)
}

function applyPartIDRepair(db: BunDatabase, operation: RepairOperation) {
  const value = (operation.after as Record<string, unknown>).id
  if (typeof value !== "string" || !value.startsWith("prt_")) throw new Error(`Invalid part id repair value for ${operation.id}`)
  const row = db.query("SELECT id, message_id, session_id FROM part WHERE id = ?").get(operation.rowId) as { id: string; message_id: string; session_id: string } | null
  if (!row || row.message_id !== operation.preconditions.message_id || row.session_id !== operation.preconditions.session_id) {
    throw new Error(`Precondition failed for ${operation.id}`)
  }
  if (!row.id.startsWith("part_")) throw new Error(`Precondition failed for ${operation.id}: id already repaired`)
  const existing = db.query("SELECT count(*) AS count FROM part WHERE id = ?").get(value) as { count: number } | null
  if (existing?.count !== 0) throw new Error(`Precondition failed for ${operation.id}: target id already exists`)
  db.query("UPDATE part SET id = ? WHERE id = ? AND message_id = ? AND session_id = ?").run(value, row.id, row.message_id, row.session_id)
}

function applyAssistantAgentRepair(db: BunDatabase, operation: RepairOperation) {
  const row = db.query("SELECT type, data FROM session_message WHERE id = ?").get(operation.rowId) as { type: string; data: string } | null
  if (!row || row.type !== operation.preconditions.type || row.data !== operation.preconditions.data) {
    throw new Error(`Precondition failed for ${operation.id}`)
  }

  const data = JSON.parse(row.data) as Record<string, unknown>
  if (typeof data.agent === "string" && data.agent.trim() !== "") throw new Error(`Precondition failed for ${operation.id}: agent already set`)
  if (data.mode !== operation.preconditions.mode || typeof data.mode !== "string" || data.mode.trim() === "") {
    throw new Error(`Precondition failed for ${operation.id}: mode changed`)
  }

  data.agent = data.mode
  db.query("UPDATE session_message SET data = ? WHERE id = ? AND data = ?").run(JSON.stringify(data), operation.rowId, row.data)
}

function applySessionMetadataRepair(db: BunDatabase, operation: RepairOperation) {
  const field = sessionMetadataField(operation.issueCode)
  const value = (operation.after as Record<string, unknown>)[field]
  if (typeof value !== "string") throw new Error(`Invalid ${field} repair value for ${operation.id}`)
  const row = db.query("SELECT agent, model, path FROM session WHERE id = ?").get(operation.rowId) as { agent: string | null; model: string | null; path: string | null } | null
  if (!row || row[field] !== operation.preconditions[field]) {
    throw new Error(`Precondition failed for ${operation.id}`)
  }
  if (typeof row[field] === "string" && row[field].trim() !== "") throw new Error(`Precondition failed for ${operation.id}: ${field} already set`)
  if (deriveSessionMetadataValue(db, operation.rowId, field) !== value) {
    throw new Error(`Precondition failed for ${operation.id}: ${field} derivation changed`)
  }
  if (field === "agent") db.query("UPDATE session SET agent = ? WHERE id = ? AND (agent IS NULL OR agent = '')").run(value, operation.rowId)
  if (field === "model") db.query("UPDATE session SET model = ? WHERE id = ? AND (model IS NULL OR model = '')").run(value, operation.rowId)
  if (field === "path") db.query("UPDATE session SET path = ? WHERE id = ? AND (path IS NULL OR path = '')").run(value, operation.rowId)
}

function sessionMetadataField(issueCode: string) {
  if (issueCode === "session_agent_missing") return "agent" as const
  if (issueCode === "session_model_missing") return "model" as const
  if (issueCode === "session_path_missing") return "path" as const
  throw new Error(`Unsupported session metadata operation: ${issueCode}`)
}

function deriveSessionMetadataValue(db: BunDatabase, sessionID: string, field: "agent" | "model" | "path") {
  if (field === "path") {
    return (db.query("SELECT directory FROM session WHERE id = ?").get(sessionID) as { directory: string } | null)?.directory
  }
  if (field === "agent") {
    return singleValue(
      db
        .query("SELECT data FROM session_message WHERE session_id = ? AND type IN ('assistant', 'agent-switched')")
        .all(sessionID)
        .map((row) => {
          const data = parseObject((row as { data: string }).data)
          return data?.agent ?? data?.mode
        })
        .filter(nonEmptyString),
    )
  }
  return singleValue(
    db
      .query("SELECT data FROM session_message WHERE session_id = ? AND type IN ('assistant', 'model-switched')")
      .all(sessionID)
      .map((row) => parseObject((row as { data: string }).data)?.model)
      .filter(isRecord)
      .map((value) => JSON.stringify(value)),
  )
}

function parseObject(input: string) {
  try {
    const value: unknown = JSON.parse(input)
    if (isRecord(value)) return value
    return undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function singleValue(values: unknown[]) {
  const unique = [...new Set(values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))))]
  if (unique.length !== 1) return undefined
  return unique[0]
}

function failedResult(dbPath: string, error: string) {
  return {
    success: false,
    backup: { path: "", createdAt: "", originalPath: dbPath },
    operationsApplied: 0,
    operationsFailed: 0,
    postCheckIssues: -1,
    error,
  } satisfies ApplyResult
}
