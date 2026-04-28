import z from "zod"
import { Slug } from "@opencode-ai/core/util/slug"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { Instance } from "@/project/instance"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { ProjectID } from "@/project/schema"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { SessionStatus } from "@/session/status"
import type { FileDiff } from "@/snapshot"
import { Worktree } from "@/worktree"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Cause, Context, Effect, Exit, Layer, Option, Schema, Types } from "effect"
import { AutomationFindingTable, AutomationRunTable, AutomationTable } from "./automation.sql"
import { AutomationFindingID, AutomationID, AutomationRunID } from "./schema"

const log = Log.create({ service: "automation" })

export const Weekday = Schema.Literals(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]).pipe(
  withStatics((s) => ({ zod: zod(s) })),
)
export type Weekday = Schema.Schema.Type<typeof Weekday>

export const ScheduleConfig = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("interval"),
    everyMinutes: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("daily"),
    time: Schema.String,
    timezone: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("weekly"),
    days: Schema.mutable(Schema.Array(Weekday)),
    time: Schema.String,
    timezone: Schema.String,
  }),
]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ScheduleConfig = Types.DeepMutable<Schema.Schema.Type<typeof ScheduleConfig>>

export const ExecutionMode = Schema.Literals(["local", "worktree"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ExecutionMode = Schema.Schema.Type<typeof ExecutionMode>

export const AutomationKind = Schema.Literals(["standalone", "thread"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type AutomationKind = Schema.Schema.Type<typeof AutomationKind>

export const PermissionProfile = Schema.Literals([
  "read_only",
  "repo_write_no_network",
  "repo_write_with_tests",
  "repo_write_network_requires_approval",
]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type PermissionProfile = Schema.Schema.Type<typeof PermissionProfile>

export const RunStatus = Schema.Literals([
  "queued",
  "preparing",
  "running",
  "needs_approval",
  "completed_with_findings",
  "completed_no_findings",
  "failed",
  "cancelled",
]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type RunStatus = Schema.Schema.Type<typeof RunStatus>

const DiffStats = Schema.Struct({
  additions: Schema.Number,
  deletions: Schema.Number,
  files: Schema.Number,
})

const Time = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  lastRun: Schema.optional(Schema.Number),
  nextRun: Schema.optional(Schema.Number),
  starts: Schema.optional(Schema.Number),
  ends: Schema.optional(Schema.Number),
})

export const Finding = Schema.Struct({
  id: AutomationFindingID,
  runID: AutomationRunID,
  title: Schema.String,
  severity: Schema.Literals(["low", "medium", "high"]),
  details: Schema.String,
  filesChanged: Schema.mutable(Schema.Array(Schema.String)),
  recommendedNextAction: Schema.optional(Schema.String),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
  }),
})
  .annotate({ identifier: "AutomationFinding" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Finding = Types.DeepMutable<Schema.Schema.Type<typeof Finding>>

export const Info = Schema.Struct({
  id: AutomationID,
  projectID: ProjectID,
  directory: Schema.String,
  title: Schema.String,
  enabled: Schema.Boolean,
  kind: AutomationKind,
  threadID: Schema.optional(SessionID),
  prompt: Schema.String,
  schedule: ScheduleConfig,
  executionMode: ExecutionMode,
  model: Schema.String,
  reasoningEffort: Schema.optional(Schema.Literals(["low", "medium", "high"])),
  permissionProfile: PermissionProfile,
  notificationBehavior: Schema.Literals(["inbox", "auto_archive_no_findings"]),
  maxRuntimeMinutes: Schema.optional(Schema.Number),
  time: Time,
})
  .annotate({ identifier: "Automation" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const RunInfo = Schema.Struct({
  id: AutomationRunID,
  automationID: AutomationID,
  projectID: ProjectID,
  directory: Schema.String,
  sessionID: Schema.optional(SessionID),
  status: RunStatus,
  promptSnapshot: Schema.String,
  modelSnapshot: Schema.String,
  executionModeSnapshot: ExecutionMode,
  scheduleSnapshot: ScheduleConfig,
  worktreePath: Schema.optional(Schema.String),
  branchName: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Literals(["findings", "no_findings", "needs_approval", "failed"])),
  findingsCount: Schema.Number,
  diffStats: Schema.optional(DiffStats),
  error: Schema.optional(Schema.String),
  time: Schema.Struct({
    created: Schema.Number,
    updated: Schema.Number,
    queued: Schema.Number,
    started: Schema.optional(Schema.Number),
    completed: Schema.optional(Schema.Number),
    read: Schema.optional(Schema.Number),
    archived: Schema.optional(Schema.Number),
  }),
})
  .annotate({ identifier: "AutomationRun" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type RunInfo = Types.DeepMutable<Schema.Schema.Type<typeof RunInfo>>

export const CreateInput = Schema.Struct({
  title: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  kind: Schema.optional(AutomationKind),
  threadID: Schema.optional(SessionID),
  prompt: Schema.String,
  schedule: ScheduleConfig,
  executionMode: Schema.optional(ExecutionMode),
  model: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(Schema.Literals(["low", "medium", "high"])),
  permissionProfile: Schema.optional(PermissionProfile),
  notificationBehavior: Schema.optional(Schema.Literals(["inbox", "auto_archive_no_findings"])),
  maxRuntimeMinutes: Schema.optional(Schema.Number),
  startsAt: Schema.optional(Schema.Number),
  endsAt: Schema.optional(Schema.Number),
})
  .annotate({ identifier: "AutomationCreateInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const UpdateInput = Schema.Struct({
  title: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  kind: Schema.optional(AutomationKind),
  threadID: Schema.optional(SessionID),
  prompt: Schema.optional(Schema.String),
  schedule: Schema.optional(ScheduleConfig),
  executionMode: Schema.optional(ExecutionMode),
  model: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(Schema.Literals(["low", "medium", "high"])),
  permissionProfile: Schema.optional(PermissionProfile),
  notificationBehavior: Schema.optional(Schema.Literals(["inbox", "auto_archive_no_findings"])),
  maxRuntimeMinutes: Schema.optional(Schema.Number),
  startsAt: Schema.optional(Schema.Number),
  endsAt: Schema.optional(Schema.Number),
})
  .annotate({ identifier: "AutomationUpdateInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export const ListRunsInput = Schema.Struct({
  automationID: Schema.optional(AutomationID),
  inbox: Schema.optional(Schema.Boolean),
  archived: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
})
  .annotate({ identifier: "AutomationListRunsInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ListRunsInput = Types.DeepMutable<Schema.Schema.Type<typeof ListRunsInput>>

export const NotFoundError = NamedError.create(
  "AutomationNotFoundError",
  z.object({
    message: z.string(),
  }),
)

type AutomationRow = typeof AutomationTable.$inferSelect
type RunRow = typeof AutomationRunTable.$inferSelect
type FindingRow = typeof AutomationFindingTable.$inferSelect

function fromRow(row: AutomationRow): Info {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: row.directory,
    title: row.title,
    enabled: row.enabled,
    kind: row.kind,
    threadID: row.thread_id ?? undefined,
    prompt: row.prompt,
    schedule: row.schedule,
    executionMode: row.execution_mode,
    model: row.model,
    reasoningEffort: row.reasoning_effort ?? undefined,
    permissionProfile: row.permission_profile,
    notificationBehavior: row.notification_behavior,
    maxRuntimeMinutes: row.max_runtime_minutes ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      lastRun: row.last_run_at ?? undefined,
      nextRun: row.next_run_at ?? undefined,
      starts: row.starts_at ?? undefined,
      ends: row.ends_at ?? undefined,
    },
  }
}

function runFromRow(row: RunRow): RunInfo {
  const diffStats =
    row.diff_additions !== null || row.diff_deletions !== null || row.diff_files !== null
      ? {
          additions: row.diff_additions ?? 0,
          deletions: row.diff_deletions ?? 0,
          files: row.diff_files ?? 0,
        }
      : undefined
  return {
    id: row.id,
    automationID: row.automation_id,
    projectID: row.project_id,
    directory: row.directory,
    sessionID: row.session_id ?? undefined,
    status: row.status,
    promptSnapshot: row.prompt_snapshot,
    modelSnapshot: row.model_snapshot,
    executionModeSnapshot: row.execution_mode_snapshot,
    scheduleSnapshot: row.schedule_snapshot,
    worktreePath: row.worktree_path ?? undefined,
    branchName: row.branch_name ?? undefined,
    summary: row.summary ?? undefined,
    result: row.result ?? undefined,
    findingsCount: row.findings_count,
    diffStats,
    error: row.error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      queued: row.time_queued,
      started: row.time_started ?? undefined,
      completed: row.time_completed ?? undefined,
      read: row.time_read ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

function findingFromRow(row: FindingRow): Finding {
  return {
    id: row.id,
    runID: row.run_id,
    title: row.title,
    severity: row.severity,
    details: row.details,
    filesChanged: row.files_changed,
    recommendedNextAction: row.recommended_next_action ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function parseTime(input: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input)
  if (!match) return { hour: 0, minute: 0 }
  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2]))),
  }
}

function zonedParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp))
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  }
}

function timezoneOffset(timestamp: number, timezone: string) {
  const parts = zonedParts(timestamp, timezone)
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return localAsUtc - timestamp
}

function zonedTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timezone: string,
) {
  const localAsUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second ?? 0)
  const firstPass = localAsUtc - timezoneOffset(localAsUtc, timezone)
  return localAsUtc - timezoneOffset(firstPass, timezone)
}

const weekdays: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

function weekdayOf(parts: { year: number; month: number; day: number }) {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000 + 4
}

export function computeNextRun(input: { schedule: ScheduleConfig; after: number; startsAt?: number; endsAt?: number }) {
  const after = Math.max(input.after, (input.startsAt ?? Number.NEGATIVE_INFINITY) - 1)
  let next: number | undefined

  if (input.schedule.type === "interval") {
    const every = Math.max(1, input.schedule.everyMinutes) * 60_000
    if (input.startsAt && input.after < input.startsAt) next = input.startsAt
    else next = input.after + every
  }

  if (input.schedule.type === "daily") {
    const { hour, minute } = parseTime(input.schedule.time)
    const parts = zonedParts(after, input.schedule.timezone)
    next = zonedTimeToUtc({ ...parts, hour, minute, second: 0 }, input.schedule.timezone)
    if (next <= after) {
      next = zonedTimeToUtc({ ...parts, day: parts.day + 1, hour, minute, second: 0 }, input.schedule.timezone)
    }
  }

  if (input.schedule.type === "weekly") {
    const { hour, minute } = parseTime(input.schedule.time)
    const parts = zonedParts(after, input.schedule.timezone)
    const today = ((weekdayOf(parts) % 7) + 7) % 7
    const wanted = new Set(input.schedule.days.map((day) => weekdays.indexOf(day)).filter((day) => day >= 0))
    for (let offset = 0; offset <= 7; offset++) {
      const day = (today + offset) % 7
      if (!wanted.has(day)) continue
      const candidate = zonedTimeToUtc(
        { ...parts, day: parts.day + offset, hour, minute, second: 0 },
        input.schedule.timezone,
      )
      if (candidate > after) {
        next = candidate
        break
      }
    }
  }

  if (!next) return undefined
  if (input.startsAt && next < input.startsAt) {
    return computeNextRun({ ...input, after: input.startsAt - 1 })
  }
  if (input.endsAt && next > input.endsAt) return undefined
  return next
}

const automationOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    result: { enum: ["findings", "no_findings", "needs_approval", "failed"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          severity: { enum: ["low", "medium", "high"] },
          details: { type: "string" },
          filesChanged: { type: "array", items: { type: "string" } },
          recommendedNextAction: { type: "string" },
        },
        required: ["title", "severity", "details", "filesChanged"],
      },
    },
    diffSummary: { type: "string" },
    commandsRun: { type: "array", items: { type: "string" } },
    needsApprovalFor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["result", "summary", "findings"],
}

const AutomationOutput = z.object({
  result: z.enum(["findings", "no_findings", "needs_approval", "failed"]),
  summary: z.string(),
  findings: z
    .array(
      z.object({
        title: z.string(),
        severity: z.enum(["low", "medium", "high"]),
        details: z.string(),
        filesChanged: z.array(z.string()).default([]),
        recommendedNextAction: z.string().optional(),
      }),
    )
    .default([]),
  diffSummary: z.string().optional(),
  commandsRun: z.array(z.string()).optional(),
  needsApprovalFor: z.string().nullable().optional(),
})

type AutomationOutput = z.infer<typeof AutomationOutput>

function rules(profile: PermissionProfile): Permission.Ruleset {
  const readOnly: Permission.Ruleset = [
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
    { permission: "list", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "write", pattern: "*", action: "deny" },
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "webfetch", pattern: "*", action: "deny" },
    { permission: "websearch", pattern: "*", action: "deny" },
    { permission: "question", pattern: "*", action: "deny" },
  ]
  if (profile === "read_only") return readOnly
  const write: Permission.Ruleset = [
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
    { permission: "list", pattern: "*", action: "allow" },
    { permission: "write", pattern: "*", action: "allow" },
    { permission: "edit", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "webfetch", pattern: "*", action: "deny" },
    { permission: "websearch", pattern: "*", action: "deny" },
    { permission: "question", pattern: "*", action: "deny" },
  ]
  if (profile === "repo_write_network_requires_approval") {
    return [
      ...write.filter((rule) => rule.permission !== "webfetch" && rule.permission !== "websearch"),
      { permission: "webfetch", pattern: "*", action: "ask" },
      { permission: "websearch", pattern: "*", action: "ask" },
    ]
  }
  return write
}

function buildPrompt(automation: Info, project: { directory: string; worktree: string }) {
  return [
    "You are running as a scheduled automation.",
    "",
    "Automation title:",
    automation.title,
    "",
    "Project directory:",
    project.directory,
    "",
    "Working tree:",
    project.worktree,
    "",
    "Schedule:",
    JSON.stringify(automation.schedule),
    "",
    "User instructions:",
    automation.prompt,
    "",
    "Execution rules:",
    "- Work inside the assigned project only.",
    "- Prefer read-only investigation unless the task clearly asks for edits.",
    "- Run relevant tests when making code changes.",
    "- Do not push, merge, deploy, send messages, or make irreversible external changes.",
    "- Return result findings whenever you changed files or have anything worth the user reviewing.",
    "- If result is findings, include at least one finding entry.",
    "- Use result no_findings only when you made no file changes and there is nothing worth reporting.",
    "- If human approval is needed, stop and return result needs_approval.",
    "- Return the required structured output exactly once.",
  ].join("\n")
}

function fallbackOutput(message: MessageV2.WithParts): AutomationOutput {
  const text = message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
  return {
    result: text.includes("NO_FINDINGS") ? "no_findings" : "findings",
    summary: text || "Automation completed.",
    findings: text.includes("NO_FINDINGS")
      ? []
      : [
          {
            title: "Automation report",
            severity: "medium",
            details: text || "The automation completed without structured findings.",
            filesChanged: [],
          },
        ],
  }
}

function defined<T extends object>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

function patchRun(runID: AutomationRunID, patch: Partial<typeof AutomationRunTable.$inferInsert>) {
  return Effect.sync(() =>
    Database.use((db) =>
      db
        .update(AutomationRunTable)
        .set({ ...defined(patch), time_updated: Date.now() })
        .where(eq(AutomationRunTable.id, runID))
        .run(),
    ),
  )
}

function insertFindings(runID: AutomationRunID, findings: AutomationOutput["findings"]) {
  return Effect.sync(() =>
    Database.transaction((db) => {
      db.delete(AutomationFindingTable).where(eq(AutomationFindingTable.run_id, runID)).run()
      for (const finding of findings) {
        const id = AutomationFindingID.ascending()
        db.insert(AutomationFindingTable)
          .values({
            id,
            run_id: runID,
            title: finding.title,
            severity: finding.severity,
            details: finding.details,
            files_changed: finding.filesChanged,
            recommended_next_action: finding.recommendedNextAction,
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()
      }
    }),
  )
}

const activeStatuses: RunStatus[] = ["queued", "preparing", "running", "needs_approval"]

function runPromptEffect(automation: Info, runID: AutomationRunID) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const summary = yield* SessionSummary.Service
    const ctx = yield* InstanceState.context
    const model = Provider.parseModel(automation.model)
    const existing =
      automation.kind === "thread" && automation.threadID
        ? yield* sessions.get(automation.threadID).pipe(
            Effect.filterOrFail((session) => {
              if (session.projectID !== automation.projectID) return false
              if (automation.projectID === ProjectID.global) return session.directory === automation.directory
              return true
            }),
            Effect.option,
          )
        : Option.none<Session.Info>()
    const session = Option.isSome(existing)
      ? existing.value
      : yield* sessions.create({
          title: `Automation: ${automation.title}`,
          permission: rules(automation.permissionProfile),
        })
    if (automation.kind === "thread") {
      yield* sessions.setPermission({ sessionID: session.id, permission: rules(automation.permissionProfile) })
      if (automation.threadID !== session.id) {
        Database.use((db) =>
          db
            .update(AutomationTable)
            .set({ thread_id: session.id, time_updated: Date.now() })
            .where(eq(AutomationTable.id, automation.id))
            .run(),
        )
      }
    }
    yield* patchRun(runID, { session_id: session.id })
    const assistant = yield* prompt.prompt({
      sessionID: session.id,
      model,
      variant: automation.reasoningEffort,
      parts: [{ type: "text", text: buildPrompt(automation, ctx) }],
      format: {
        type: "json_schema",
        schema: automationOutputSchema,
        retryCount: 1,
      },
    })
    const diffs = yield* summary.diff({ sessionID: session.id })
    return { sessionID: session.id, assistant, diffs }
  })
}

const WorktreeRunLayer = Layer.mergeAll(Session.defaultLayer, SessionPrompt.defaultLayer, SessionSummary.defaultLayer)
const restartInterruptedStatuses: RunStatus[] = ["queued", "preparing", "running"]
const restartInterruptedMessage =
  "Automation run was interrupted because OpenCode stopped before it completed. Start the automation again to run it from a clean state."

export type LiveRunInfo = {
  id: AutomationRunID
  automationID: AutomationID
  projectID: ProjectID
  directory: string
  title: string
  status: Extract<RunStatus, "queued" | "preparing" | "running">
}

const liveRuns = new Map<AutomationRunID, LiveRunInfo>()

function trackLiveRun(automation: Info, runID: AutomationRunID, status: LiveRunInfo["status"]) {
  liveRuns.set(runID, {
    id: runID,
    automationID: automation.id,
    projectID: automation.projectID,
    directory: automation.directory,
    title: automation.title,
    status,
  })
}

function updateLiveRunStatus(runID: AutomationRunID, status: LiveRunInfo["status"]) {
  const current = liveRuns.get(runID)
  if (!current) return
  liveRuns.set(runID, { ...current, status })
}

function untrackLiveRun(runID: AutomationRunID) {
  liveRuns.delete(runID)
}

export function listLiveRuns(): LiveRunInfo[] {
  return [...liveRuns.values()]
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: AutomationID) => Effect.Effect<Info, InstanceType<typeof NotFoundError>>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (id: AutomationID, input: UpdateInput) => Effect.Effect<Info, InstanceType<typeof NotFoundError>>
  readonly remove: (id: AutomationID) => Effect.Effect<boolean>
  readonly duplicate: (id: AutomationID) => Effect.Effect<Info, InstanceType<typeof NotFoundError>>
  readonly runNow: (id: AutomationID) => Effect.Effect<RunInfo, InstanceType<typeof NotFoundError>>
  readonly listRuns: (input?: ListRunsInput) => Effect.Effect<RunInfo[]>
  readonly getRun: (id: AutomationRunID) => Effect.Effect<RunInfo, InstanceType<typeof NotFoundError>>
  readonly listFindings: (runID: AutomationRunID) => Effect.Effect<Finding[]>
  readonly diff: (runID: AutomationRunID) => Effect.Effect<FileDiff[], InstanceType<typeof NotFoundError>>
  readonly markRunRead: (
    runID: AutomationRunID,
    read?: boolean,
  ) => Effect.Effect<RunInfo, InstanceType<typeof NotFoundError>>
  readonly archiveRun: (
    runID: AutomationRunID,
    archived?: boolean,
  ) => Effect.Effect<RunInfo, InstanceType<typeof NotFoundError>>
  readonly cancelRun: (runID: AutomationRunID) => Effect.Effect<RunInfo, InstanceType<typeof NotFoundError>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Automation") {}

type SchedulerState = {
  started: boolean
  timer?: ReturnType<typeof setInterval>
  running: Set<AutomationID>
}

const schedulerIntervalMs = 60_000
const missedGraceMs = 60 * 60_000

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const sessionStatus = yield* SessionStatus.Service
    const sessionSummary = yield* SessionSummary.Service
    const worktree = yield* Worktree.Service
    const provider = yield* Provider.Service

    const scheduler = yield* InstanceState.make<SchedulerState>(
      Effect.fn("Automation.schedulerState")(function* () {
        const state: SchedulerState = { started: false, running: new Set() }
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (state.timer) clearInterval(state.timer)
            state.running.clear()
          }),
        )
        return state
      }),
    )

    const scope = Effect.map(InstanceState.context, (ctx) => ({
      projectID: ctx.project.id,
      directory: ctx.directory,
    }))

    const selectAutomation = Effect.fn("Automation.select")(function* (id: AutomationID) {
      const current = yield* scope
      const row = Database.use((db) =>
        db
          .select()
          .from(AutomationTable)
          .where(
            and(
              eq(AutomationTable.id, id),
              eq(AutomationTable.project_id, current.projectID),
              eq(AutomationTable.directory, current.directory),
            ),
          )
          .get(),
      )
      if (!row) throw new NotFoundError({ message: `Automation not found: ${id}` })
      return fromRow(row)
    })

    const getRun = Effect.fn("Automation.getRun")(function* (id: AutomationRunID) {
      const current = yield* scope
      const row = Database.use((db) =>
        db
          .select()
          .from(AutomationRunTable)
          .where(
            and(
              eq(AutomationRunTable.id, id),
              eq(AutomationRunTable.project_id, current.projectID),
              eq(AutomationRunTable.directory, current.directory),
            ),
          )
          .get(),
      )
      if (!row) throw new NotFoundError({ message: `Automation run not found: ${id}` })
      return runFromRow(row)
    })

    const list = Effect.fn("Automation.list")(function* () {
      const current = yield* scope
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationTable)
          .where(
            and(eq(AutomationTable.project_id, current.projectID), eq(AutomationTable.directory, current.directory)),
          )
          .orderBy(desc(AutomationTable.time_created))
          .all(),
      )
      return rows.map(fromRow)
    })

    const create = Effect.fn("Automation.create")(function* (input: CreateInput) {
      const ctx = yield* InstanceState.context
      const defaultRef = input.model ? undefined : yield* provider.defaultModel()
      const defaultModel = input.model ?? `${defaultRef!.providerID}/${defaultRef!.modelID}`
      const now = Date.now()
      const enabled = input.enabled ?? true
      const kind = input.kind ?? "standalone"
      const schedule = input.schedule
      const nextRunAt = enabled
        ? computeNextRun({ schedule, after: now, startsAt: input.startsAt, endsAt: input.endsAt })
        : undefined
      const id = AutomationID.ascending()
      Database.use((db) =>
        db
          .insert(AutomationTable)
          .values({
            id,
            project_id: ctx.project.id,
            directory: ctx.directory,
            title: input.title,
            enabled,
            kind,
            thread_id: kind === "thread" ? (input.threadID ?? null) : null,
            prompt: input.prompt,
            schedule,
            execution_mode: input.executionMode ?? "local",
            model: defaultModel,
            reasoning_effort: input.reasoningEffort,
            permission_profile:
              input.permissionProfile ?? (input.executionMode === "local" ? "read_only" : "repo_write_no_network"),
            notification_behavior: input.notificationBehavior ?? "auto_archive_no_findings",
            max_runtime_minutes: input.maxRuntimeMinutes,
            starts_at: input.startsAt,
            ends_at: input.endsAt,
            next_run_at: nextRunAt ?? null,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      return yield* selectAutomation(id)
    })

    const update = Effect.fn("Automation.update")(function* (id: AutomationID, input: UpdateInput) {
      const current = yield* selectAutomation(id)
      const enabled = input.enabled ?? current.enabled
      const kind = input.kind ?? current.kind
      const schedule = input.schedule ?? current.schedule
      const startsAt = input.startsAt ?? current.time.starts
      const endsAt = input.endsAt ?? current.time.ends
      const shouldRecomputeNext =
        input.enabled !== undefined ||
        input.schedule !== undefined ||
        input.startsAt !== undefined ||
        input.endsAt !== undefined
      const nextRunAt = shouldRecomputeNext
        ? enabled
          ? computeNextRun({ schedule, after: Date.now(), startsAt, endsAt })
          : undefined
        : current.time.nextRun
      const row = Database.use((db) =>
        db
          .update(AutomationTable)
          .set(
            defined({
              title: input.title,
              enabled,
              kind: input.kind,
              thread_id: kind === "standalone" ? null : input.threadID,
              prompt: input.prompt,
              schedule: input.schedule,
              execution_mode: input.executionMode,
              model: input.model,
              reasoning_effort: input.reasoningEffort,
              permission_profile: input.permissionProfile,
              notification_behavior: input.notificationBehavior,
              max_runtime_minutes: input.maxRuntimeMinutes,
              starts_at: startsAt,
              ends_at: endsAt,
              next_run_at: nextRunAt ?? null,
              time_updated: Date.now(),
            }),
          )
          .where(eq(AutomationTable.id, id))
          .returning()
          .get(),
      )
      if (!row) throw new NotFoundError({ message: `Automation not found: ${id}` })
      return fromRow(row)
    })

    const remove = Effect.fn("Automation.remove")(function* (id: AutomationID) {
      yield* selectAutomation(id)
      Database.use((db) => db.delete(AutomationTable).where(eq(AutomationTable.id, id)).run())
      return true
    })

    const duplicate = Effect.fn("Automation.duplicate")(function* (id: AutomationID) {
      const automation = yield* selectAutomation(id)
      return yield* create({
        title: `${automation.title} copy`,
        enabled: false,
        kind: automation.kind,
        prompt: automation.prompt,
        schedule: automation.schedule,
        executionMode: automation.executionMode,
        model: automation.model,
        reasoningEffort: automation.reasoningEffort,
        permissionProfile: automation.permissionProfile,
        notificationBehavior: automation.notificationBehavior,
        maxRuntimeMinutes: automation.maxRuntimeMinutes,
        startsAt: automation.time.starts,
        endsAt: automation.time.ends,
      })
    })

    const listRuns = Effect.fn("Automation.listRuns")(function* (input?: ListRunsInput) {
      const current = yield* scope
      const conditions = [
        eq(AutomationRunTable.project_id, current.projectID),
        eq(AutomationRunTable.directory, current.directory),
      ]
      if (input?.automationID) conditions.push(eq(AutomationRunTable.automation_id, input.automationID))
      if (input?.inbox) {
        conditions.push(
          inArray(AutomationRunTable.status, [
            "completed_with_findings",
            "completed_no_findings",
            "failed",
            "needs_approval",
          ]),
        )
        if (input.archived === undefined) conditions.push(sql`${AutomationRunTable.time_archived} is null`)
      }
      if (input?.archived === true) conditions.push(sql`${AutomationRunTable.time_archived} is not null`)
      if (input?.archived === false) conditions.push(sql`${AutomationRunTable.time_archived} is null`)
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationRunTable)
          .where(and(...conditions))
          .orderBy(desc(AutomationRunTable.time_created))
          .limit(input?.limit ?? 100)
          .all(),
      )
      return rows.map(runFromRow)
    })

    const listFindings = Effect.fn("Automation.listFindings")(function* (runID: AutomationRunID) {
      yield* getRun(runID)
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationFindingTable)
          .where(eq(AutomationFindingTable.run_id, runID))
          .orderBy(AutomationFindingTable.time_created)
          .all(),
      )
      return rows.map(findingFromRow)
    })

    const diff = Effect.fn("Automation.diff")(function* (runID: AutomationRunID) {
      const run = yield* getRun(runID)
      if (!run.sessionID) return []
      return yield* sessionSummary.diff({ sessionID: run.sessionID })
    })

    const finishRun = Effect.fn("Automation.finishRun")(function* (
      automation: Info,
      runID: AutomationRunID,
      output: AutomationOutput,
      diffs: FileDiff[],
    ) {
      const now = Date.now()
      const hasReviewableOutput = output.result === "findings" || output.findings.length > 0 || diffs.length > 0
      const status: RunStatus =
        output.result === "needs_approval"
          ? "needs_approval"
          : output.result === "failed"
            ? "failed"
            : output.result === "no_findings" && !hasReviewableOutput
              ? "completed_no_findings"
              : "completed_with_findings"
      const findings =
        output.findings.length > 0 || status !== "completed_with_findings"
          ? output.findings
          : [
              {
                title: "Automation report",
                severity: "medium" as const,
                details: [output.summary, output.diffSummary].filter(Boolean).join("\n\n") || "Automation completed.",
                filesChanged: diffs.map((diff) => diff.file),
              },
            ]
      const nextRunAt = computeNextRun({
        schedule: automation.schedule,
        after: now,
        startsAt: automation.time.starts,
        endsAt: automation.time.ends,
      })
      const archiveNoFindings =
        status === "completed_no_findings" && automation.notificationBehavior === "auto_archive_no_findings"
      yield* insertFindings(runID, findings)
      yield* patchRun(runID, {
        status,
        result: output.result,
        summary: output.summary,
        findings_count: findings.length,
        diff_additions: diffs.reduce((sum, item) => sum + item.additions, 0),
        diff_deletions: diffs.reduce((sum, item) => sum + item.deletions, 0),
        diff_files: diffs.length,
        error: output.result === "failed" ? output.summary : undefined,
        time_completed: now,
        time_read: archiveNoFindings ? now : undefined,
        time_archived: archiveNoFindings ? now : undefined,
      })
      Database.use((db) =>
        db
          .update(AutomationTable)
          .set({ last_run_at: now, next_run_at: nextRunAt ?? null, time_updated: now })
          .where(eq(AutomationTable.id, automation.id))
          .run(),
      )
    })

    const failRun = Effect.fn("Automation.failRun")(function* (
      automation: Info,
      runID: AutomationRunID,
      error: unknown,
    ) {
      const now = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      const nextRunAt = computeNextRun({
        schedule: automation.schedule,
        after: now,
        startsAt: automation.time.starts,
        endsAt: automation.time.ends,
      })
      yield* patchRun(runID, {
        status: "failed",
        result: "failed",
        summary: message,
        error: message,
        time_completed: now,
      })
      Database.use((db) =>
        db
          .update(AutomationTable)
          .set({ last_run_at: now, next_run_at: nextRunAt ?? null, time_updated: now })
          .where(eq(AutomationTable.id, automation.id))
          .run(),
      )
    })

    const markInterruptedRun = Effect.fn("Automation.markInterruptedRun")(function* (
      automation: Info,
      runID: AutomationRunID,
    ) {
      const now = Date.now()
      const run = yield* getRun(runID).pipe(Effect.option)
      const nextRunAt = automation.enabled
        ? computeNextRun({
            schedule: automation.schedule,
            after: now,
            startsAt: automation.time.starts,
            endsAt: automation.time.ends,
          })
        : undefined
      if (Option.isSome(run) && run.value.sessionID) {
        yield* markInterruptedSession(run.value.sessionID).pipe(Effect.ignore)
      }
      yield* patchRun(runID, {
        status: "failed",
        result: "failed",
        summary: restartInterruptedMessage,
        error: restartInterruptedMessage,
        time_completed: now,
      })
      Database.use((db) =>
        db
          .update(AutomationTable)
          .set({ last_run_at: now, next_run_at: nextRunAt ?? null, time_updated: now })
          .where(eq(AutomationTable.id, automation.id))
          .run(),
      )
    })

    const markInterruptedSession = Effect.fn("Automation.markInterruptedSession")(function* (sessionID: SessionID) {
      const now = Date.now()
      const messages = yield* sessions.messages({ sessionID })
      for (const message of messages) {
        if (message.info.role !== "assistant") continue
        const dangling = message.parts.some(
          (part) =>
            (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) ||
            ((part.type === "text" || part.type === "reasoning") && part.time && !part.time.end),
        )
        if (message.info.time.completed && !dangling) continue

        for (const part of message.parts) {
          if (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) {
            const start = part.state.status === "running" ? part.state.time.start : now
            const metadata =
              part.state.status === "running"
                ? { ...(part.state.metadata ?? {}), interrupted: true }
                : { interrupted: true }
            yield* sessions.updatePart({
              ...part,
              state: {
                status: "error",
                input: part.state.input,
                error: "Automation interrupted because OpenCode exited.",
                metadata,
                time: { start, end: now },
              },
            } satisfies MessageV2.ToolPart)
          }

          if ((part.type === "text" || part.type === "reasoning") && part.time && !part.time.end) {
            yield* sessions.updatePart({
              ...part,
              time: { ...part.time, end: now },
            })
          }
        }

        yield* sessions.updateMessage({
          ...message.info,
          finish: message.info.finish ?? "stop",
          error:
            message.info.error ??
            MessageV2.fromError(new DOMException(restartInterruptedMessage, "AbortError"), {
              providerID: message.info.providerID,
              aborted: true,
            }),
          time: {
            ...message.info.time,
            completed: message.info.time.completed ?? now,
          },
        } satisfies MessageV2.Assistant)
      }
      yield* sessionStatus.set(sessionID, { type: "idle" })
    })

    const execute = Effect.fn("Automation.execute")(function* (runID: AutomationRunID) {
      const state = yield* InstanceState.get(scheduler)
      const run = yield* getRun(runID)
      if (run.status === "cancelled") return
      const automation = yield* selectAutomation(run.automationID)
      state.running.add(automation.id)
      const exit = yield* Effect.gen(function* () {
        yield* patchRun(runID, { status: "preparing", time_started: Date.now() })
        updateLiveRunStatus(runID, "preparing")
        let worktreeInfo: Worktree.Info | undefined
        if (automation.executionMode === "worktree") {
          worktreeInfo = yield* worktree.makeWorktreeInfo(`automation-${Slug.create()}`)
          yield* patchRun(runID, {
            worktree_path: worktreeInfo.directory,
            branch_name: worktreeInfo.branch,
          })
          yield* worktree.createFromInfo(worktreeInfo)
        }
        yield* patchRun(runID, { status: "running" })
        updateLiveRunStatus(runID, "running")
        const task = automation.maxRuntimeMinutes
          ? runPromptEffect(automation, runID).pipe(
              Effect.timeoutOrElse({
                duration: automation.maxRuntimeMinutes * 60_000,
                orElse: () => Effect.die(new Error(`Automation exceeded ${automation.maxRuntimeMinutes} minute limit`)),
              }),
            )
          : runPromptEffect(automation, runID)
        const result = worktreeInfo
          ? yield* Effect.promise(async () => {
              const nested = await Instance.provide({
                directory: worktreeInfo!.directory,
                fn: () => Effect.runPromise(task.pipe(Effect.provide(WorktreeRunLayer))),
              })
              return await nested
            })
          : yield* task
        const structured =
          result.assistant.info.role === "assistant" && result.assistant.info.structured
            ? AutomationOutput.safeParse(result.assistant.info.structured)
            : undefined
        const output = structured?.success ? structured.data : fallbackOutput(result.assistant)
        if (result.assistant.info.role === "assistant" && result.assistant.info.error) {
          output.result = "failed"
          output.summary = JSON.stringify(result.assistant.info.error)
        }
        const latest = yield* getRun(runID)
        if (latest.status === "cancelled") return
        yield* finishRun(automation, runID, output, result.diffs)
      }).pipe(
        Effect.exit,
        Effect.ensuring(
          Effect.sync(() => {
            state.running.delete(automation.id)
            untrackLiveRun(runID)
          }),
        ),
      )
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        log.error("automation run failed", { runID, error })
        const latest = yield* getRun(runID).pipe(Effect.option)
        if (Option.isSome(latest) && latest.value.status === "cancelled") return
        yield* failRun(automation, runID, error)
      }
    })

    const skipOverlappingRun = Effect.fn("Automation.skipOverlappingRun")(function* (automation: Info) {
      const nextRunAt = computeNextRun({
        schedule: automation.schedule,
        after: Date.now(),
        startsAt: automation.time.starts,
        endsAt: automation.time.ends,
      })
      Database.use((db) =>
        db
          .update(AutomationTable)
          .set({ next_run_at: nextRunAt ?? null, time_updated: Date.now() })
          .where(eq(AutomationTable.id, automation.id))
          .run(),
      )
    })

    const enqueue = Effect.fn("Automation.enqueue")(function* (automation: Info) {
      const state = yield* InstanceState.get(scheduler)
      const active = Database.use((db) =>
        db
          .select()
          .from(AutomationRunTable)
          .where(
            and(
              eq(AutomationRunTable.automation_id, automation.id),
              inArray(AutomationRunTable.status, activeStatuses),
            ),
          )
          .orderBy(desc(AutomationRunTable.time_created))
          .get(),
      )
      if (active) {
        const activeRun = runFromRow(active)
        if (state.running.has(automation.id)) {
          yield* skipOverlappingRun(automation)
          return activeRun
        }
        if (restartInterruptedStatuses.includes(activeRun.status)) {
          yield* markInterruptedRun(automation, activeRun.id)
        } else {
          return activeRun
        }
      }
      const now = Date.now()
      const id = AutomationRunID.ascending()
      Database.use((db) =>
        db
          .insert(AutomationRunTable)
          .values({
            id,
            automation_id: automation.id,
            project_id: automation.projectID,
            directory: automation.directory,
            status: "queued",
            prompt_snapshot: automation.prompt,
            model_snapshot: automation.model,
            execution_mode_snapshot: automation.executionMode,
            schedule_snapshot: automation.schedule,
            findings_count: 0,
            time_queued: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      trackLiveRun(automation, id, "queued")
      const bridge = yield* EffectBridge.make()
      void bridge.promise(execute(id)).catch((error) => log.error("automation execution crashed", { runID: id, error }))
      return yield* getRun(id)
    })

    const repair = Effect.fn("Automation.repair")(function* () {
      const current = yield* scope
      const now = Date.now()
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationTable)
          .where(
            and(
              eq(AutomationTable.project_id, current.projectID),
              eq(AutomationTable.directory, current.directory),
              eq(AutomationTable.enabled, true),
            ),
          )
          .all(),
      )
      for (const row of rows) {
        if (row.next_run_at !== null) continue
        const automation = fromRow(row)
        const nextRunAt = computeNextRun({
          schedule: automation.schedule,
          after: now,
          startsAt: automation.time.starts,
          endsAt: automation.time.ends,
        })
        Database.use((db) =>
          db
            .update(AutomationTable)
            .set({ next_run_at: nextRunAt ?? null, time_updated: now })
            .where(eq(AutomationTable.id, automation.id))
            .run(),
        )
      }
    })

    const failInterruptedRuns = Effect.fn("Automation.failInterruptedRuns")(function* () {
      const current = yield* scope
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationRunTable)
          .where(
            and(
              eq(AutomationRunTable.project_id, current.projectID),
              eq(AutomationRunTable.directory, current.directory),
              inArray(AutomationRunTable.status, restartInterruptedStatuses),
            ),
          )
          .orderBy(desc(AutomationRunTable.time_created))
          .all(),
      )
      for (const row of rows) {
        const automation = yield* selectAutomation(row.automation_id).pipe(Effect.option)
        if (Option.isNone(automation)) continue
        yield* markInterruptedRun(automation.value, row.id)
      }
    })

    const repairInterruptedRunSessions = Effect.fn("Automation.repairInterruptedRunSessions")(function* () {
      const current = yield* scope
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationRunTable)
          .where(
            and(
              eq(AutomationRunTable.project_id, current.projectID),
              eq(AutomationRunTable.directory, current.directory),
              eq(AutomationRunTable.status, "failed"),
              eq(AutomationRunTable.error, restartInterruptedMessage),
              sql`${AutomationRunTable.session_id} is not null`,
            ),
          )
          .orderBy(desc(AutomationRunTable.time_created))
          .all(),
      )
      for (const row of rows) {
        if (!row.session_id) continue
        yield* markInterruptedSession(row.session_id).pipe(Effect.ignore)
      }
    })

    const tick = Effect.fn("Automation.tick")(function* () {
      const current = yield* scope
      const now = Date.now()
      const rows = Database.use((db) =>
        db
          .select()
          .from(AutomationTable)
          .where(
            and(
              eq(AutomationTable.project_id, current.projectID),
              eq(AutomationTable.directory, current.directory),
              eq(AutomationTable.enabled, true),
              lte(AutomationTable.next_run_at, now),
            ),
          )
          .all(),
      )
      for (const row of rows) {
        const automation = fromRow(row)
        if (automation.time.nextRun && now - automation.time.nextRun > missedGraceMs) {
          const nextRunAt = computeNextRun({
            schedule: automation.schedule,
            after: now,
            startsAt: automation.time.starts,
            endsAt: automation.time.ends,
          })
          Database.use((db) =>
            db
              .update(AutomationTable)
              .set({ next_run_at: nextRunAt ?? null, time_updated: now })
              .where(eq(AutomationTable.id, automation.id))
              .run(),
          )
          continue
        }
        yield* enqueue(automation)
      }
    })

    const init = Effect.fn("Automation.init")(function* () {
      const state = yield* InstanceState.get(scheduler)
      if (state.started) return
      state.started = true
      yield* failInterruptedRuns()
      yield* repairInterruptedRunSessions()
      yield* repair()
      yield* tick()
      const bridge = yield* EffectBridge.make()
      state.timer = setInterval(() => {
        void bridge.promise(tick()).catch((error) => log.error("automation scheduler tick failed", { error }))
      }, schedulerIntervalMs)
      state.timer.unref?.()
    })

    const runNow = Effect.fn("Automation.runNow")(function* (id: AutomationID) {
      const automation = yield* selectAutomation(id)
      return yield* enqueue(automation)
    })

    const markRunRead = Effect.fn("Automation.markRunRead")(function* (runID: AutomationRunID, read = true) {
      yield* getRun(runID)
      yield* patchRun(runID, { time_read: read ? Date.now() : null })
      return yield* getRun(runID)
    })

    const archiveRun = Effect.fn("Automation.archiveRun")(function* (runID: AutomationRunID, archived = true) {
      yield* getRun(runID)
      yield* patchRun(runID, { time_archived: archived ? Date.now() : null })
      return yield* getRun(runID)
    })

    const cancelRun = Effect.fn("Automation.cancelRun")(function* (runID: AutomationRunID) {
      const run = yield* getRun(runID)
      if (!activeStatuses.includes(run.status)) return run
      const automation = yield* selectAutomation(run.automationID)
      const now = Date.now()
      if (run.sessionID) yield* prompt.cancel(run.sessionID)
      yield* patchRun(runID, { status: "cancelled", time_completed: now })
      untrackLiveRun(runID)
      const nextRunAt = automation.enabled
        ? computeNextRun({
            schedule: automation.schedule,
            after: now,
            startsAt: automation.time.starts,
            endsAt: automation.time.ends,
          })
        : undefined
      Database.use((db) =>
        db
          .update(AutomationTable)
          .set({ next_run_at: nextRunAt ?? null, time_updated: now })
          .where(eq(AutomationTable.id, automation.id))
          .run(),
      )
      return yield* getRun(runID)
    })

    return Service.of({
      init,
      list,
      get: selectAutomation,
      create,
      update,
      remove,
      duplicate,
      runNow,
      listRuns,
      getRun,
      listFindings,
      diff,
      markRunRead,
      archiveRun,
      cancelRun,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionPrompt.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Worktree.defaultLayer),
  ),
)

export * as Automation from "./automation"
