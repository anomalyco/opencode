export * as DatabaseHealth from "./health"

import { Database as BunDatabase } from "bun:sqlite"
import { InstallationVersion } from "../installation/version"
import { migrations } from "./migration.gen"
export type RepairMode = "safe"
export type IssueSeverity = "info" | "warning" | "error"
export type Confidence = "low" | "medium" | "high"

export interface SupportedRepair {
  code: string
  table: "session" | "session_message" | "part"
  repairable: boolean
  targetOpenCodeVersion: string
  targetMigration?: string
  targetInvariant: string
  sourceEvidence: string
  description: string
  repair: string
  safety: string
}

export interface CompatibilityContext {
  targetOpenCodeVersion: string
  expectedMigrations: string[]
  latestExpectedMigration?: string
  sessionVersions: { version: string; count: number }[]
  appliedMigrations: string[]
  latestAppliedMigration?: string
}

export const SUPPORTED_REPAIRS = [
  {
    code: "part_legacy_id_prefix",
    table: "part",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "Session message part IDs must satisfy PartID, which currently requires the prt_ prefix.",
    sourceEvidence: "Observed on affected session.version values 1.2.21 and 1.2.22. No exact SDK/OpenCode change boundary is asserted here; detection is based on violating the migrated target invariant.",
    description: "Historical message part rows use part_ IDs, while the migrated target schema validates message part IDs with the prt_ prefix.",
    repair: "Rename part.id from part_<suffix> to prt_<suffix> when the target id does not already exist.",
    safety: "Primary-key update only; message/session foreign key columns and part data are unchanged; apply rechecks the source row and target-id absence.",
  },
  {
    code: "assistant_message_missing_agent",
    table: "session_message",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "Assistant session_message.data should carry agent, not only mode.",
    sourceEvidence: "Matched by target-shape violation: missing data.agent with non-empty data.mode.",
    description: "Assistant session_message.data rows may have mode but no agent after migration to the current target shape.",
    repair: "Copy data.mode to data.agent when mode is a single non-empty string and agent is missing.",
    safety: "JSON update only; apply rechecks the original JSON payload and mode before writing.",
  },
  {
    code: "session_agent_missing",
    table: "session",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetMigration: "20260511173437_session-metadata",
    targetInvariant: "session.agent is present when a single unambiguous agent can be derived.",
    sourceEvidence: "Matched by target-shape violation after the session metadata migration: missing session.agent.",
    description: "Session rows may miss the denormalized session.agent field required by the migrated target shape.",
    repair: "Set session.agent only when one unambiguous value can be derived from assistant or agent-switched messages.",
    safety: "Skipped when no single value is derivable; apply rederives the value before writing.",
  },
  {
    code: "session_model_missing",
    table: "session",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetMigration: "20260511173437_session-metadata",
    targetInvariant: "session.model is present when a single unambiguous model can be derived.",
    sourceEvidence: "Matched by target-shape violation after the session metadata migration: missing session.model.",
    description: "Session rows may miss the denormalized session.model field required by the migrated target shape.",
    repair: "Set session.model only when one unambiguous model object can be derived from assistant or model-switched messages.",
    safety: "Skipped when no single value is derivable; apply rederives the value before writing.",
  },
  {
    code: "session_path_missing",
    table: "session",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetMigration: "20260428004200_add_session_path",
    targetInvariant: "session.path is present when session.directory is non-empty.",
    sourceEvidence: "Matched by target-shape violation after the session.path migration: missing session.path with non-empty session.directory.",
    description: "Session rows may miss session.path after migration to the current target shape.",
    repair: "Set session.path from the same row's session.directory when directory is non-empty.",
    safety: "Does not rewrite directory/worktree semantics; apply rechecks the original empty path and derived directory value.",
  },
] satisfies SupportedRepair[]

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
  compatibility: CompatibilityContext
  supportedRepairs: SupportedRepair[]
  sessionCount?: number
  messageCount?: number
  issues: Issue[]
  exitCode: 0 | 1 | 2
}

export interface RepairOperation {
  id: string
  issueCode: string
  table: "session" | "session_message" | "part"
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
  compatibility: CompatibilityContext
  supportedRepairs: SupportedRepair[]
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
    part: Set<string>
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

interface PartRow {
  id: string
  message_id: string
  session_id: string
}

export async function generateDoctorReport(dbPath: string): Promise<DoctorReport> {
  if (!(await Bun.file(dbPath).exists())) {
    return unreadableDoctorReport(dbPath, "database_not_found", "Database file does not exist")
  }

  try {
    return withReadOnlyDatabase(dbPath, (db) => {
      const schema = analyzeSchema(db)
      if (!schema.supported) {
        return buildReport(dbPath, schema, readCompatibility(db), 0, 0, schema.issues)
      }

      const sessions = analyzeSessions(db, schema.columns.session)
      const messages = analyzeMessages(db)
      const parts = analyzeParts(db, schema.columns.part)
      return buildReport(dbPath, schema, readCompatibility(db), sessions.count, messages.count, [...schema.issues, ...sessions.issues, ...messages.issues, ...parts.issues])
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
          compatibility: readCompatibility(db),
          supportedRepairs: SUPPORTED_REPAIRS,
          operations: [],
          warnings: schema.issues.map((issue) => issue.reason),
          exitCode: 2 as const,
        } satisfies RepairPlan
      }

      const sessions = analyzeSessions(db, schema.columns.session)
      const messages = analyzeMessages(db)
      const parts = analyzeParts(db, schema.columns.part)
      const issues = [...sessions.issues, ...messages.issues, ...parts.issues]
      const operations = issues.flatMap((issue) => operationForIssue(db, issue))
      return {
        dbPath,
        generatedAt: new Date().toISOString(),
        mode,
        compatibility: readCompatibility(db),
        supportedRepairs: SUPPORTED_REPAIRS,
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
  const part = tableColumns(db, "part")
  const project = tableColumns(db, "project")
  const issues: Issue[] = [
    ...missingTableIssues("session_message", sessionMessage),
    ...missingTableIssues("session", session),
    ...missingTableIssues("project", project),
  ]

  if (issues.length > 0) {
    return { supported: false, issues, columns: { session, sessionMessage, part, project } }
  }

  const columnIssues: Issue[] = [
    ...missingColumnIssues("session_message", sessionMessage, ["id", "session_id", "type", "data"]),
    ...missingColumnIssues("session", session, ["id", "project_id", "directory", "path", "agent", "model"]),
    ...optionalMissingColumnIssues("part", part, ["id", "message_id", "session_id"]),
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
    columns: { session, sessionMessage, part, project },
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

export function analyzeParts(db: BunDatabase, columns?: Set<string>): { count: number; issues: Issue[] } {
  if (columns?.size === 0) return { count: 0, issues: [] }
  const count = readCount(db, "part")
  if (columns && !(columns.has("id") && columns.has("message_id") && columns.has("session_id"))) return { count, issues: [] }

  return {
    count,
    issues: db
      .query("SELECT id, message_id, session_id FROM part WHERE id LIKE 'part\\_%' ESCAPE '\\'")
      .all()
      .flatMap((row) => partIDIssues(db, row as PartRow)),
  }
}

function buildReport(dbPath: string, schema: SchemaStatus, compatibility: CompatibilityContext, sessionCount: number, messageCount: number, issues: Issue[]) {
  return {
    dbPath,
    checkedAt: new Date().toISOString(),
    schemaSupported: schema.supported,
    compatibility,
    supportedRepairs: SUPPORTED_REPAIRS,
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
    compatibility: readCompatibility(undefined),
    supportedRepairs: SUPPORTED_REPAIRS,
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
    compatibility: readCompatibility(undefined),
    supportedRepairs: SUPPORTED_REPAIRS,
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

function readCompatibility(db: BunDatabase | undefined): CompatibilityContext {
  const expectedMigrations = migrations.map((migration) => migration.id)
  if (!db) {
    return {
      targetOpenCodeVersion: InstallationVersion,
      expectedMigrations,
      latestExpectedMigration: expectedMigrations.at(-1),
      sessionVersions: [],
      appliedMigrations: [],
    }
  }
  const sessionVersions = tableColumns(db, "session").has("version")
    ? (db.query("SELECT version, count(*) AS count FROM session GROUP BY version ORDER BY count DESC").all() as { version: string; count: number }[])
    : []
  const appliedMigrations = tableColumns(db, "migration").has("id")
    ? (db.query("SELECT id FROM migration ORDER BY id").all() as { id: string }[]).map((row) => row.id)
    : []
  return {
    targetOpenCodeVersion: InstallationVersion,
    expectedMigrations,
    latestExpectedMigration: expectedMigrations.at(-1),
    sessionVersions,
    appliedMigrations,
    latestAppliedMigration: appliedMigrations.at(-1),
  }
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

function optionalMissingColumnIssues(table: string, columns: Set<string>, required: string[]): Issue[] {
  if (columns.size === 0) return []
  return missingColumnIssues(table, columns, required)
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

function partIDIssues(db: BunDatabase, row: PartRow): Issue[] {
  const repaired = `prt_${row.id.slice("part_".length)}`
  const exists = (db.query("SELECT count(*) AS count FROM part WHERE id = ?").get(repaired) as { count: number } | null)?.count !== 0
  return [
    {
      code: "part_legacy_id_prefix",
      severity: "error" as const,
      table: "part",
      rowId: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      repairable: !exists,
      reason: exists ? "part.id uses the legacy part_ prefix, but the target prt_ id already exists" : "part.id uses the legacy part_ prefix; current schemas require prt_",
      suggestedRepair: exists ? undefined : "rename_part_id_prefix",
      confidence: exists ? undefined : ("high" as const),
      before: { id: row.id },
      after: exists ? undefined : { id: repaired },
    },
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
  if (issue.code === "part_legacy_id_prefix" && issue.rowId && issue.repairable) return [partIDOperation(db, issue)]
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

function partIDOperation(db: BunDatabase, issue: Issue) {
  if (!issue.rowId) throw new Error("Missing part repair row id")
  const row = db.query("SELECT id, message_id, session_id FROM part WHERE id = ?").get(issue.rowId) as PartRow
  return {
    id: `repair_part_id_${row.id}`,
    issueCode: issue.code,
    table: "part" as const,
    rowId: row.id,
    before: issue.before,
    after: issue.after,
    preconditions: { id: row.id, message_id: row.message_id, session_id: row.session_id },
    reason: issue.reason,
    confidence: "high" as const,
    backupRequired: true,
    mode: "safe" as const,
  }
}
