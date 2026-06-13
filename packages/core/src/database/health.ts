export * as DatabaseHealth from "./health"

import { Database as BunDatabase } from "bun:sqlite"
export type RepairMode = "safe"
export type IssueSeverity = "info" | "warning" | "error"
export type Confidence = "low" | "medium" | "high"

export interface Issue {
  code: string
  severity: IssueSeverity
  table?: string
  rowId?: string
  sessionId?: string
  messageId?: string
  repairable: boolean
  reason: string
  suggestedRepair?: string
  confidence?: Confidence
  before?: unknown
  after?: unknown
  warning?: string
}

export interface DoctorReport {
  dbPath: string
  checkedAt: string
  schemaSupported: boolean
  sessionCount?: number
  messageCount?: number
  issues: Issue[]
  exitCode: 0 | 1 | 2
}

export interface RepairOperation {
  id: string
  issueCode: string
  table: "session" | "session_message"
  rowId: string
  before: unknown
  after: unknown
  preconditions: Record<string, unknown>
  reason: string
  confidence: Confidence
  backupRequired: boolean
  mode: RepairMode
  warning?: string
}

export interface RepairPlan {
  dbPath: string
  generatedAt: string
  mode: RepairMode
  operations: RepairOperation[]
  warnings: string[]
  exitCode: 0 | 1 | 2
}

interface SchemaStatus {
  supported: boolean
  issues: Issue[]
  columns: {
    session: Set<string>
    sessionMessage: Set<string>
    project: Set<string>
  }
}

interface SessionRow {
  id: string
  project_id: string | null
  directory: string
  path: string | null
  agent: string | null
  model: string | null
}

interface SessionMessageRow {
  id: string
  session_id: string
  type: string
  data: string
}

export async function generateDoctorReport(dbPath: string): Promise<DoctorReport> {
  if (!(await Bun.file(dbPath).exists())) {
    return unreadableDoctorReport(dbPath, "database_not_found", "Database file does not exist")
  }

  try {
    return withReadOnlyDatabase(dbPath, (db) => {
      const schema = analyzeSchema(db)
      if (!schema.supported) {
        return buildReport(dbPath, schema, 0, 0, schema.issues)
      }

      const sessions = analyzeSessions(db, schema.columns.session)
      const messages = analyzeMessages(db)
      return buildReport(dbPath, schema, sessions.count, messages.count, [...schema.issues, ...sessions.issues, ...messages.issues])
    })
  } catch (error) {
    return unreadableDoctorReport(dbPath, "database_unreadable", `Database is unreadable: ${errorMessage(error)}`)
  }
}

export async function generateRepairPlan(dbPath: string, mode: RepairMode = "safe"): Promise<RepairPlan> {
  if (!(await Bun.file(dbPath).exists())) {
    return unreadableRepairPlan(dbPath, mode, "Database file does not exist")
  }

  try {
    return withReadOnlyDatabase(dbPath, (db) => {
      const schema = analyzeSchema(db)
      if (!schema.supported) {
        return {
          dbPath,
          generatedAt: new Date().toISOString(),
          mode,
          operations: [],
          warnings: schema.issues.map((issue) => issue.reason),
          exitCode: 2 as const,
        } satisfies RepairPlan
      }

      const sessions = analyzeSessions(db, schema.columns.session)
      const messages = analyzeMessages(db)
      const issues = [...sessions.issues, ...messages.issues]
      const operations = issues.flatMap((issue) => operationForIssue(db, issue))
      return {
        dbPath,
        generatedAt: new Date().toISOString(),
        mode,
        operations,
        warnings: operations.flatMap((operation) => (operation.warning ? [operation.warning] : [])),
        exitCode: operations.length > 0 ? 1 : 0,
      } satisfies RepairPlan
    })
  } catch (error) {
    return unreadableRepairPlan(dbPath, mode, `Database is unreadable: ${errorMessage(error)}`)
  }
}

export function analyzeSchema(db: BunDatabase): SchemaStatus {
  const sessionMessage = tableColumns(db, "session_message")
  const session = tableColumns(db, "session")
  const project = tableColumns(db, "project")
  const issues: Issue[] = [
    ...missingTableIssues("session_message", sessionMessage),
    ...missingTableIssues("session", session),
    ...missingTableIssues("project", project),
  ]

  if (issues.length > 0) {
    return { supported: false, issues, columns: { session, sessionMessage, project } }
  }

  const columnIssues: Issue[] = [
    ...missingColumnIssues("session_message", sessionMessage, ["id", "session_id", "type", "data"]),
    ...missingColumnIssues("session", session, ["id", "project_id", "directory", "path", "agent", "model"]),
    ...missingColumnIssues("project", project, ["id", "worktree"]),
  ]

  if (!sessionMessage.has("seq")) {
    columnIssues.push({
      code: "session_message_seq_not_present",
      severity: "info",
      table: "session_message",
      repairable: false,
      reason: "session_message.seq column is not present; current upstream schema does not require repair",
    })
  }

  return {
    supported: !columnIssues.some((issue) => issue.severity === "error"),
    issues: columnIssues,
    columns: { session, sessionMessage, project },
  }
}

export function analyzeSessions(db: BunDatabase, columns?: Set<string>): { count: number; issues: Issue[] } {
  const count = readCount(db, "session")
  if (columns && !(columns.has("agent") && columns.has("model") && columns.has("path"))) return { count, issues: [] }

  return {
    count,
    issues: db
      .query("SELECT id, project_id, directory, path, agent, model FROM session WHERE agent IS NULL OR agent = '' OR model IS NULL OR model = '' OR path IS NULL OR path = ''")
      .all()
      .flatMap((row) => sessionMetadataIssues(db, row as SessionRow)),
  }
}

export function analyzeMessages(db: BunDatabase): { count: number; issues: Issue[] } {
  const rows = db.query("SELECT id, session_id, type, data FROM session_message WHERE type = ?").all("assistant")
  return {
    count: readCount(db, "session_message"),
    issues: rows.flatMap((row) => assistantMessageIssues(row as SessionMessageRow)),
  }
}

function buildReport(dbPath: string, schema: SchemaStatus, sessionCount: number, messageCount: number, issues: Issue[]) {
  return {
    dbPath,
    checkedAt: new Date().toISOString(),
    schemaSupported: schema.supported,
    sessionCount,
    messageCount,
    issues,
    exitCode: !schema.supported ? 2 : issues.some((issue) => issue.severity === "error") ? 1 : 0,
  } satisfies DoctorReport
}

function unreadableDoctorReport(dbPath: string, code: string, reason: string) {
  return {
    dbPath,
    checkedAt: new Date().toISOString(),
    schemaSupported: false,
    issues: [
      {
        code,
        severity: "error" as const,
        repairable: false,
        reason,
      },
    ],
    exitCode: 2 as const,
  } satisfies DoctorReport
}

function unreadableRepairPlan(dbPath: string, mode: RepairMode, reason: string) {
  return {
    dbPath,
    generatedAt: new Date().toISOString(),
    mode,
    operations: [],
    warnings: [reason],
    exitCode: 2 as const,
  } satisfies RepairPlan
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return "Unknown database error"
}

function withReadOnlyDatabase<T>(dbPath: string, run: (db: BunDatabase) => T) {
  const db = new BunDatabase(dbPath, { readonly: true, create: false })
  try {
    return run(db)
  } finally {
    db.close()
  }
}

function tableColumns(db: BunDatabase, table: string) {
  if ((db.query("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { count: number } | null)?.count !== 1) {
    return new Set<string>()
  }
  return new Set(db.query(`PRAGMA table_info(${table})`).all().map((row) => (row as { name: string }).name))
}

function missingTableIssues(table: string, columns: Set<string>): Issue[] {
  if (columns.size > 0) return []
  return [
    {
      code: `${table}_table_missing`,
      severity: "error" as const,
      table,
      repairable: false,
      reason: `${table} table does not exist`,
    },
  ]
}

function missingColumnIssues(table: string, columns: Set<string>, required: string[]): Issue[] {
  return required
    .filter((column) => !columns.has(column))
    .map((column) => ({
      code: `${table}_required_column_missing_${column}`,
      severity: "error" as const,
      table,
      repairable: false,
      reason: `Required column ${table}.${column} is missing`,
    }))
}

function readCount(db: BunDatabase, table: string) {
  return (db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number } | null)?.count ?? 0
}

function assistantMessageIssues(row: SessionMessageRow): Issue[] {
  const data = parseObject(row.data)
  if (!data) {
    return [
      {
        code: "session_message_malformed_json",
        severity: "warning" as const,
        table: "session_message",
        rowId: row.id,
        sessionId: row.session_id,
        messageId: row.id,
        repairable: false,
        reason: "session_message.data contains malformed JSON",
      },
    ]
  }

  if (nonEmptyString(data.agent) || !nonEmptyString(data.mode)) return []
  return [
    {
      code: "assistant_message_missing_agent",
      severity: "error" as const,
      table: "session_message",
      rowId: row.id,
      sessionId: row.session_id,
      messageId: row.id,
      repairable: true,
      reason: "Assistant message has data.mode but data.agent is missing or empty",
      suggestedRepair: "copy_mode_to_agent",
      confidence: "high" as const,
      before: { data: row.data, agent: data.agent, mode: data.mode },
      after: { agent: data.mode },
    },
  ]
}

function sessionMetadataIssues(db: BunDatabase, row: SessionRow): Issue[] {
  return [
    ...metadataIssue(row, "agent", deriveSessionAgent(db, row.id)),
    ...metadataIssue(row, "model", deriveSessionModel(db, row.id)),
    ...metadataIssue(row, "path", nonEmptyString(row.directory) ? row.directory : undefined),
  ]
}

function metadataIssue(row: SessionRow, field: "agent" | "model" | "path", derived: unknown): Issue[] {
  if (nonEmptyString(row[field])) return []
  return [
    {
      code: `session_${field}_missing`,
      severity: "warning" as const,
      table: "session",
      rowId: row.id,
      sessionId: row.id,
      repairable: derived !== undefined,
      reason: derived === undefined ? `session.${field} is missing and no single unambiguous value is derivable` : `session.${field} is missing`,
      suggestedRepair: derived === undefined ? undefined : `set_session_${field}`,
      confidence: derived === undefined ? undefined : ("high" as const),
      before: { [field]: row[field] },
      after: derived === undefined ? undefined : { [field]: derived },
    },
  ]
}

function deriveSessionAgent(db: BunDatabase, sessionID: string) {
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

function deriveSessionModel(db: BunDatabase, sessionID: string) {
  return singleValue(
    db
      .query("SELECT data FROM session_message WHERE session_id = ? AND type IN ('assistant', 'model-switched')")
      .all(sessionID)
      .map((row) => parseObject((row as { data: string }).data)?.model)
      .filter(isRecord)
      .map((value) => JSON.stringify(value)),
  )
}

function operationForIssue(db: BunDatabase, issue: Issue): RepairOperation[] {
  if (issue.code === "assistant_message_missing_agent" && issue.rowId) return [assistantOperation(db, issue)]
  if (issue.code.startsWith("session_") && issue.code.endsWith("_missing") && issue.rowId && issue.repairable) return [sessionMetadataOperation(db, issue)]
  return []
}

function assistantOperation(db: BunDatabase, issue: Issue) {
  if (!issue.rowId) throw new Error("Missing assistant repair row id")
  const row = db.query("SELECT id, session_id, type, data FROM session_message WHERE id = ?").get(issue.rowId) as SessionMessageRow
  const data = parseObject(row.data)
  return {
    id: `repair_assistant_agent_${row.id}`,
    issueCode: issue.code,
    table: "session_message" as const,
    rowId: row.id,
    before: issue.before,
    after: issue.after,
    preconditions: { id: row.id, type: "assistant", data: row.data, mode: data?.mode },
    reason: issue.reason,
    confidence: "high" as const,
    backupRequired: true,
    mode: "safe" as const,
  }
}

function sessionMetadataOperation(db: BunDatabase, issue: Issue) {
  if (!issue.rowId) throw new Error("Missing session repair row id")
  const row = db.query("SELECT id, agent, model, path FROM session WHERE id = ?").get(issue.rowId) as Pick<SessionRow, "id" | "agent" | "model" | "path">
  return {
    id: `repair_${issue.code}_${row.id}`,
    issueCode: issue.code,
    table: "session" as const,
    rowId: row.id,
    before: issue.before,
    after: issue.after,
    preconditions: { id: row.id, agent: row.agent, model: row.model, path: row.path },
    reason: issue.reason,
    confidence: "high" as const,
    backupRequired: true,
    mode: "safe" as const,
  }
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
