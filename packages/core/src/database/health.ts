export * as DatabaseHealth from "./health"

import { Database as BunDatabase } from "bun:sqlite"
import { InstallationVersion } from "../installation/version"
import { migrations } from "./migration.gen"
export type RepairMode = "safe"
export type IssueSeverity = "info" | "warning" | "error"
export type Confidence = "low" | "medium" | "high"

export interface SupportedRepair {
  code: string
  table: "session" | "session_message" | "message" | "part"
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
  {
    code: "message_assistant_missing_parent",
    table: "message",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "Assistant message data must include parentID for the current MessageV2.WithParts response schema.",
    sourceEvidence: "Reported in #29908 as Missing key at message info parentID after schema tightening without a backfill migration.",
    description: "Assistant message rows can miss parentID after migration to the current target shape.",
    repair: "Set parentID to the immediately preceding message in the same session when one exists.",
    safety: "Skipped when no preceding message exists; apply rechecks the original JSON payload before writing.",
  },
  {
    code: "message_user_missing_agent",
    table: "message",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "User message data must include agent for the current MessageV2.WithParts response schema.",
    sourceEvidence: "Reported in #29908 as Missing key at user message agent after schema tightening without a backfill migration.",
    description: "User message rows can miss agent after migration to the current target shape.",
    repair: "Set agent only when one unambiguous agent can be derived from messages in the same session.",
    safety: "Skipped when no single value is derivable; apply rederives the value before writing.",
  },
  {
    code: "message_user_missing_model",
    table: "message",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "User message data must include model.providerID and model.modelID for the current MessageV2.WithParts response schema.",
    sourceEvidence: "Reported in #29908 as Missing key at user message model after schema tightening without a backfill migration.",
    description: "User message rows can miss model after migration to the current target shape.",
    repair: "Set model only when one unambiguous model can be derived from assistant messages in the same session.",
    safety: "Skipped when no single value is derivable; apply rederives the value before writing.",
  },
  {
    code: "part_step_finish_missing_reason",
    table: "part",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "step-finish parts must include reason for the current Part schema.",
    sourceEvidence: "Reported in #29908 as Missing key at parts reason after schema tightening without a backfill migration.",
    description: "step-finish part rows can miss reason after migration to the current target shape.",
    repair: "Set reason to stop when the key is missing.",
    safety: "Only adds the missing reason key; apply rechecks the original JSON payload before writing.",
  },
  {
    code: "part_compaction_missing_auto",
    table: "part",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "compaction parts must include auto for the current Part schema.",
    sourceEvidence: "Reported in #29908 as compaction parts missing auto after schema tightening without a backfill migration.",
    description: "compaction part rows can miss auto after migration to the current target shape.",
    repair: "Set auto to false when the key is missing.",
    safety: "Only adds the missing auto key; apply rechecks the original JSON payload before writing.",
  },
  {
    code: "part_tool_completed_missing_metadata",
    table: "part",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "completed tool parts must include state.metadata for the current Part schema.",
    sourceEvidence: "Reported in #29908 as completed tool parts missing state.metadata after schema tightening without a backfill migration.",
    description: "completed tool part rows can miss state.metadata after migration to the current target shape.",
    repair: "Set state.metadata to an empty object when the key is missing.",
    safety: "Only adds the missing metadata key; apply rechecks the original JSON payload before writing.",
  },
  {
    code: "part_tool_completed_missing_title",
    table: "part",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "completed tool parts must include state.title for the current Part schema.",
    sourceEvidence: "Reported in #29908 as completed tool parts missing state.title after schema tightening without a backfill migration.",
    description: "completed tool part rows can miss state.title after migration to the current target shape.",
    repair: "Set state.title from the part tool name when available.",
    safety: "Skipped when the tool name is not a non-empty string; apply rechecks the original JSON payload before writing.",
  },
  {
    code: "part_tool_completed_missing_time",
    table: "part",
    repairable: true,
    targetOpenCodeVersion: InstallationVersion,
    targetInvariant: "completed tool parts must include state.time.start and state.time.end for the current Part schema.",
    sourceEvidence: "Reported in #29908 as completed tool parts missing state.time after schema tightening without a backfill migration.",
    description: "completed tool part rows can miss state.time after migration to the current target shape.",
    repair: "Set missing start/end timestamps from the part row time_created.",
    safety: "Only fills missing time keys from the row timestamp; apply rechecks the original JSON payload before writing.",
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
  table: "session" | "session_message" | "message" | "part"
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
  unrepairableErrors: string[]
  exitCode: 0 | 1 | 2
}

interface SchemaStatus {
  supported: boolean
  issues: Issue[]
  columns: {
    session: Set<string>
    sessionMessage: Set<string>
    message: Set<string>
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

interface MessageRow {
  id: string
  session_id: string
  time_created: number
  data: string
}

interface PartRow {
  id: string
  message_id: string
  session_id: string
  time_created?: number
  data?: string
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
      const sessionMessages = analyzeSessionMessages(db)
      const messages = analyzeMessages(db, schema.columns.message)
      const parts = analyzeParts(db, schema.columns.part)
      return buildReport(dbPath, schema, readCompatibility(db), sessions.count, messages.count, [...schema.issues, ...sessions.issues, ...sessionMessages.issues, ...messages.issues, ...parts.issues])
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
          unrepairableErrors: schema.issues.filter((issue) => issue.severity === "error").map((issue) => issue.reason),
          exitCode: 2 as const,
        } satisfies RepairPlan
      }

      const sessions = analyzeSessions(db, schema.columns.session)
      const sessionMessages = analyzeSessionMessages(db)
      const messages = analyzeMessages(db, schema.columns.message)
      const parts = analyzeParts(db, schema.columns.part)
      const issues = [...sessions.issues, ...sessionMessages.issues, ...messages.issues, ...parts.issues]
      const operations = issues.flatMap((issue) => operationForIssue(db, issue))
      const unrepairableErrors = issues.filter((issue) => issue.severity === "error" && !issue.repairable).map((issue) => issue.reason)
      return {
        dbPath,
        generatedAt: new Date().toISOString(),
        mode,
        compatibility: readCompatibility(db),
        supportedRepairs: SUPPORTED_REPAIRS,
        operations,
        unrepairableErrors,
        warnings: [
          ...issues.filter((issue) => !issue.repairable).map((issue) => issue.reason),
          ...operations.flatMap((operation) => (operation.warning ? [operation.warning] : [])),
        ],
        exitCode: operations.length > 0 || issues.some((issue) => issue.severity === "error") ? 1 : 0,
      } satisfies RepairPlan
    })
  } catch (error) {
    return unreadableRepairPlan(dbPath, mode, `Database is unreadable: ${errorMessage(error)}`)
  }
}

export function analyzeSchema(db: BunDatabase): SchemaStatus {
  const sessionMessage = tableColumns(db, "session_message")
  const session = tableColumns(db, "session")
  const message = tableColumns(db, "message")
  const part = tableColumns(db, "part")
  const project = tableColumns(db, "project")
  const issues: Issue[] = [
    ...missingTableIssues("session_message", sessionMessage),
    ...missingTableIssues("session", session),
    ...missingTableIssues("project", project),
  ]

  if (issues.length > 0) {
    return { supported: false, issues, columns: { session, sessionMessage, message, part, project } }
  }

  const columnIssues: Issue[] = [
    ...missingColumnIssues("session_message", sessionMessage, ["id", "session_id", "type", "data"]),
    ...optionalMissingColumnIssues("message", message, ["id", "session_id", "time_created", "data"]),
    ...missingColumnIssues("session", session, ["id", "project_id", "directory", "path", "agent", "model"]),
    ...optionalMissingColumnIssues("part", part, ["id", "message_id", "session_id", "time_created", "data"]),
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
    columns: { session, sessionMessage, message, part, project },
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

export function analyzeSessionMessages(db: BunDatabase): { count: number; issues: Issue[] } {
  const rows = db.query("SELECT id, session_id, type, data FROM session_message WHERE type = ?").all("assistant")
  return {
    count: readCount(db, "session_message"),
    issues: rows.flatMap((row) => assistantMessageIssues(row as SessionMessageRow)),
  }
}

export function analyzeMessages(db: BunDatabase, columns?: Set<string>): { count: number; issues: Issue[] } {
  if (columns?.size === 0) return { count: 0, issues: [] }
  const count = readCount(db, "message")
  if (columns && !(columns.has("id") && columns.has("session_id") && columns.has("time_created") && columns.has("data"))) return { count, issues: [] }

  return {
    count,
    issues: db
      .query(
        "SELECT id, session_id, time_created, data FROM message WHERE CASE WHEN json_valid(data) = 0 THEN 1 WHEN json_type(data) != 'object' THEN 1 ELSE ((json_extract(data, '$.role') = 'assistant' AND json_extract(data, '$.parentID') IS NULL) OR (json_extract(data, '$.role') = 'user' AND (json_extract(data, '$.agent') IS NULL OR json_extract(data, '$.model') IS NULL))) END",
      )
      .all()
      .flatMap((row) => messageIssues(db, row as MessageRow)),
  }
}

export function analyzeParts(db: BunDatabase, columns?: Set<string>): { count: number; issues: Issue[] } {
  if (columns?.size === 0) return { count: 0, issues: [] }
  const count = readCount(db, "part")
  if (columns && !(columns.has("id") && columns.has("message_id") && columns.has("session_id"))) return { count, issues: [] }

  return {
    count,
    issues: db
      .query(
        "SELECT id, message_id, session_id, time_created, data FROM part WHERE id LIKE 'part\\_%' ESCAPE '\\' OR CASE WHEN json_valid(data) = 0 THEN 1 WHEN json_type(data) != 'object' THEN 1 ELSE ((json_extract(data, '$.type') = 'step-finish' AND json_extract(data, '$.reason') IS NULL) OR (json_extract(data, '$.type') = 'compaction' AND json_extract(data, '$.auto') IS NULL) OR (json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'completed' AND (json_extract(data, '$.state.metadata') IS NULL OR json_extract(data, '$.state.title') IS NULL OR json_extract(data, '$.state.time.start') IS NULL OR json_extract(data, '$.state.time.end') IS NULL))) END",
      )
      .all()
      .flatMap((row) => partIssues(db, row as PartRow)),
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
    unrepairableErrors: [reason],
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

function messageIssues(db: BunDatabase, row: MessageRow): Issue[] {
  const data = parseObject(row.data)
  if (!data) return malformedDataIssue("message", row.id, row.session_id, row.id, "message.data contains malformed JSON")
  if (data.role === "assistant") {
    return missingFieldIssues(row, [
      ["parentID", deriveAssistantParentID(db, row), "message_assistant_missing_parent", "set_message_parent"],
    ])
  }
  if (data.role === "user") {
    return missingFieldIssues(row, [
      ["agent", deriveMessageAgent(db, row.session_id), "message_user_missing_agent", "set_message_agent"],
      ["model", deriveMessageModel(db, row.session_id), "message_user_missing_model", "set_message_model"],
    ])
  }
  return []
}

function partIssues(db: BunDatabase, row: PartRow): Issue[] {
  return [...(row.id.startsWith("part_") ? partIDIssues(db, row) : []), ...partDataIssues(row)]
}

function partDataIssues(row: PartRow): Issue[] {
  if (!row.data) return []
  const data = parseObject(row.data)
  if (!data) return malformedDataIssue("part", row.id, row.session_id, row.message_id, "part.data contains malformed JSON")
  if (data.type === "step-finish" && data.reason === undefined) return [jsonFieldIssue(row, "part_step_finish_missing_reason", "reason", "stop", "set_step_finish_reason")]
  if (data.type === "compaction" && data.auto === undefined) return [jsonFieldIssue(row, "part_compaction_missing_auto", "auto", false, "set_compaction_auto")]
  if (data.type !== "tool" || !isRecord(data.state) || data.state.status !== "completed") return []
  return [
    ...(data.state.metadata === undefined ? [jsonFieldIssue(row, "part_tool_completed_missing_metadata", "state.metadata", {}, "set_tool_state_metadata")] : []),
    ...(data.state.title === undefined && nonEmptyString(data.tool) ? [jsonFieldIssue(row, "part_tool_completed_missing_title", "state.title", data.tool, "set_tool_state_title")] : []),
    ...(isRecord(data.state.time) && data.state.time.start !== undefined && data.state.time.end !== undefined
      ? []
      : [
          jsonFieldIssue(
            row,
            "part_tool_completed_missing_time",
            "state.time",
            { start: isRecord(data.state.time) && data.state.time.start !== undefined ? data.state.time.start : (row.time_created ?? 0), end: isRecord(data.state.time) && data.state.time.end !== undefined ? data.state.time.end : (row.time_created ?? 0) },
            "set_tool_state_time",
          ),
        ]),
  ]
}

function malformedDataIssue(table: "message" | "part", rowId: string, sessionId: string, messageId: string, reason: string): Issue[] {
  return [{ code: `${table}_malformed_json`, severity: "warning" as const, table, rowId, sessionId, messageId, repairable: false, reason }]
}

function missingFieldIssues(row: MessageRow, fields: [string, unknown, string, string][]): Issue[] {
  const data = parseObject(row.data)
  if (!data) return []
  return fields
    .filter(([field]) => data[field] === undefined || data[field] === null || data[field] === "")
    .map(([field, derived, code, suggestedRepair]) => ({
      code,
      severity: "error" as const,
      table: "message",
      rowId: row.id,
      sessionId: row.session_id,
      messageId: row.id,
      repairable: derived !== undefined,
      reason: derived === undefined ? `message.data.${field} is missing and no single unambiguous value is derivable` : `message.data.${field} is missing`,
      suggestedRepair: derived === undefined ? undefined : suggestedRepair,
      confidence: derived === undefined ? undefined : ("high" as const),
      before: { data: row.data, [field]: data[field] },
      after: derived === undefined ? undefined : { [field]: derived },
    }))
}

function jsonFieldIssue(row: PartRow, code: string, field: string, value: unknown, suggestedRepair: string): Issue {
  return {
    code,
    severity: "error" as const,
    table: "part",
    rowId: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    repairable: true,
    reason: `part.data.${field} is missing`,
    suggestedRepair,
    confidence: "high" as const,
    before: { data: row.data, [field]: undefined },
    after: { [field]: value },
  }
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

function deriveAssistantParentID(db: BunDatabase, row: MessageRow) {
  return (
    db
      .query("SELECT id FROM message WHERE session_id = ? AND (time_created < ? OR (time_created = ? AND id < ?)) ORDER BY time_created DESC, id DESC LIMIT 1")
      .get(row.session_id, row.time_created, row.time_created, row.id) as { id: string } | null
  )?.id
}

function deriveMessageAgent(db: BunDatabase, sessionID: string) {
  const sessionAgent = (db.query("SELECT agent FROM session WHERE id = ?").get(sessionID) as { agent: string | null } | null)?.agent
  if (nonEmptyString(sessionAgent)) return sessionAgent
  return singleValue(
    db
      .query("SELECT data FROM message WHERE session_id = ? AND json_valid(data) = 1 AND json_extract(data, '$.role') = 'assistant'")
      .all(sessionID)
      .map((row) => parseObject((row as { data: string }).data)?.agent)
      .filter(nonEmptyString),
  )
}

function deriveMessageModel(db: BunDatabase, sessionID: string) {
  const unique = [
    ...new Set(
      db
        .query("SELECT data FROM message WHERE session_id = ? AND json_valid(data) = 1 AND json_extract(data, '$.role') = 'assistant'")
        .all(sessionID)
        .map((row) => {
          const data = parseObject((row as { data: string }).data)
          if (!nonEmptyString(data?.providerID) || !nonEmptyString(data?.modelID)) return undefined
          return JSON.stringify({ providerID: data.providerID, modelID: data.modelID, ...(nonEmptyString(data.variant) ? { variant: data.variant } : {}) })
        })
        .filter(nonEmptyString),
    ),
  ]
  if (unique.length !== 1) return undefined
  return JSON.parse(unique[0]) as Record<string, unknown>
}

function operationForIssue(db: BunDatabase, issue: Issue): RepairOperation[] {
  if (issue.code === "assistant_message_missing_agent" && issue.rowId) return [assistantOperation(db, issue)]
  if (issue.code.startsWith("session_") && issue.code.endsWith("_missing") && issue.rowId && issue.repairable) return [sessionMetadataOperation(db, issue)]
  if (issue.code.startsWith("message_") && issue.rowId && issue.repairable) return [messageOperation(db, issue)]
  if (issue.code.startsWith("part_") && issue.code !== "part_legacy_id_prefix" && issue.rowId && issue.repairable) return [partDataOperation(db, issue)]
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

function messageOperation(db: BunDatabase, issue: Issue) {
  if (!issue.rowId) throw new Error("Missing message repair row id")
  const row = db.query("SELECT id, session_id, time_created, data FROM message WHERE id = ?").get(issue.rowId) as MessageRow
  return {
    id: `repair_${issue.code}_${row.id}`,
    issueCode: issue.code,
    table: "message" as const,
    rowId: row.id,
    before: issue.before,
    after: issue.after,
    preconditions: { id: row.id, session_id: row.session_id, time_created: row.time_created, data: row.data },
    reason: issue.reason,
    confidence: "high" as const,
    backupRequired: true,
    mode: "safe" as const,
  }
}

function partDataOperation(db: BunDatabase, issue: Issue) {
  if (!issue.rowId) throw new Error("Missing part repair row id")
  const row = db.query("SELECT id, message_id, session_id, time_created, data FROM part WHERE id = ?").get(issue.rowId) as PartRow
  return {
    id: `repair_${issue.code}_${row.id}`,
    issueCode: issue.code,
    table: "part" as const,
    rowId: row.id,
    before: issue.before,
    after: issue.after,
    preconditions: { id: row.id, message_id: row.message_id, session_id: row.session_id, time_created: row.time_created, data: row.data },
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
