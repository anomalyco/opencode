import { Effect, Option, Schema, type Types } from "effect"
import { and, eq, gte, lt, sql } from "drizzle-orm"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { Event } from "@opencode/schema/event"
import { SessionEvent } from "@opencode/schema/session-event"
import { ToolMode } from "@opencode/schema/session-stats"
import { TokenUsage } from "@opencode/schema/token-usage"
import type { Database } from "../database/database.js"
import { EventTable } from "../event/sql.js"
import { SessionMessageTable, SessionPartTable, SessionTable } from "./sql.js"

export type Input = {
  readonly from?: number
  readonly to?: number
  readonly projectID?: Project.ID
  readonly timezone?: string
  readonly tools?: ToolMode
}

export type ResolvedInput = Omit<Input, "to"> & {
  readonly to: number
}

export type RawResult = Effect.Success<ReturnType<typeof compute>>

type Tokens = Types.DeepMutable<TokenUsage.Info>

type MessageRow = {
  sessionID: string
  parentID: string | null
  type: "user" | "assistant"
  timeCreated: number
  metrics: string | null
}

type MessageMetrics = [
  providerID: string | null,
  modelID: string | null,
  variant: string | null,
  input: number | null,
  output: number | null,
  reasoning: number | null,
  cacheRead: number | null,
  cacheWrite: number | null,
  cost: number | null,
]

type ToolRow = {
  tool: string | null
}

type ToolTuple = [
  name: string | null,
  status: string | null,
  completed: number | null,
  ran: number | null,
  created: number | null,
]

type ToolSummaryRow = {
  calls: number
  succeeded: number
  failed: number
  unfinished: number
}

type ModelAggregate = {
  model: Model.Ref
  steps: number
  tokens: Tokens
  cost: number
}

type ToolAggregate = {
  name: string
  calls: number
  succeeded: number
  failed: number
  unfinished: number
  durations: number[]
}

const decodeUsage = Schema.decodeUnknownOption(SessionEvent.UsageRecorded.data)
const UsageRecordedType = Event.versionedType(
  SessionEvent.UsageRecorded.type,
  SessionEvent.UsageRecorded.durable.version,
)
// Inline the event type literal so SQLite's planner uses `event_usage_recorded_created_idx`
// even on builds without SQLITE_ENABLE_STAT4.
const UsageRecordedTypeSql = sql.raw(`'${UsageRecordedType.replaceAll("'", "''")}'`)
const Window = 31 * 24 * 60 * 60 * 1_000

export const compute = Effect.fn("SessionStats.compute")(function* (
  db: Database.Interface["db"],
  input: ResolvedInput,
) {
  const to = input.to
  const project = input.projectID === undefined ? sql`` : sql`AND session.project_id = ${input.projectID}`
  const from =
    input.from ??
    (yield* db
      .get<{ time: number | null }>(
        sql`
        SELECT min(message.time_created) AS time
        FROM ${SessionMessageTable} AS message
        JOIN ${SessionTable} AS session ON session.id = message.session_id
        WHERE message.type IN ('user', 'assistant')
          AND message.time_created < ${to}
          AND (session.fork_session_id IS NULL OR message.time_created >= session.time_created)
          ${project}
      `,
      )
      .pipe(Effect.orDie))?.time ??
    to
  const ranges = windows(from, to)
  const toolMode = input.tools ?? "summary"
  const sessions = new Set<string>()
  const subagents = new Set<string>()
  const activity = new Map<string, number>()
  const models = new Map<string, ModelAggregate>()
  const tools = new Map<string, ToolAggregate>()
  const totals = {
    prompts: 0,
    steps: 0,
    tokens: emptyTokens(),
    cost: 0,
  }
  const toolTotals = { calls: 0, succeeded: 0, failed: 0, unfinished: 0 }
  const dateKey = makeDateKey(input.timezone)

  yield* Effect.forEach(
    ranges,
    (range) =>
      db
        .all<MessageRow>(
          sql`
          SELECT
            message.session_id AS sessionID,
            session.parent_id AS parentID,
            message.type AS type,
            message.time_created AS timeCreated,
            CASE
              WHEN message.type = 'assistant' THEN json_extract(
                message.data,
                '$.model.providerID',
                '$.model.id',
                '$.model.variant',
                '$.tokens.input',
                '$.tokens.output',
                '$.tokens.reasoning',
                '$.tokens.cache.read',
                '$.tokens.cache.write',
                '$.cost'
              )
              ELSE NULL
            END AS metrics
          FROM ${SessionMessageTable} AS message
          JOIN ${SessionTable} AS session ON session.id = message.session_id
          WHERE message.type IN ('user', 'assistant')
            AND message.time_created >= ${range.from}
            AND message.time_created < ${range.to}
            AND (session.fork_session_id IS NULL OR message.time_created >= session.time_created)
            ${project}
        `,
        )
        .pipe(
          Effect.orDie,
          Effect.tap((rows) =>
            Effect.sync(() => {
              rows.forEach((row) => {
                if (row.parentID === null) sessions.add(row.sessionID)
                else subagents.add(row.sessionID)
                if (row.type === "user") {
                  if (row.parentID === null) totals.prompts++
                  return
                }

                totals.steps++
                const metrics = parseMetrics(row.metrics)
                const tokens = rowTokens(metrics)
                addTokens(totals.tokens, tokens)
                totals.cost += metrics[8] ?? 0
                const day = dateKey(row.timeCreated)
                activity.set(day, (activity.get(day) ?? 0) + 1)
                const providerID = metrics[0]
                const modelID = metrics[1]
                if (!providerID || !modelID) return
                const variant = metrics[2]
                const key = `${providerID}/${modelID}#${variant ?? ""}`
                const model = models.get(key) ?? {
                  model: {
                    providerID: Provider.ID.make(providerID),
                    id: Model.ID.make(modelID),
                    variant: variant ? Model.VariantID.make(variant) : undefined,
                  },
                  steps: 0,
                  tokens: emptyTokens(),
                  cost: 0,
                }
                models.set(key, model)
                model.steps++
                model.cost += metrics[8] ?? 0
                addTokens(model.tokens, tokens)
              })
            }),
          ),
        ),
    { concurrency: 1, discard: true },
  )

  if (toolMode !== "none")
    yield* Effect.forEach(
      ranges,
      (range) => {
        if (toolMode === "summary")
          return db
            .get<ToolSummaryRow>(
              sql`
            WITH calls AS (
              SELECT json_extract(part.data, '$.state.status') AS status
              FROM ${SessionPartTable} AS part
              JOIN ${SessionMessageTable} AS message ON message.id = part.message_id
              JOIN ${SessionTable} AS session ON session.id = message.session_id
              WHERE message.type = 'assistant'
                AND message.time_created >= ${range.from}
                AND message.time_created < ${range.to}
                AND (session.fork_session_id IS NULL OR message.time_created >= session.time_created)
                AND part.type = 'tool'
                ${project}
              UNION ALL
              SELECT json_extract(content.value, '$.state.status') AS status
              FROM ${SessionMessageTable} AS message
              JOIN ${SessionTable} AS session ON session.id = message.session_id,
                json_each(message.data, '$.content') AS content
              WHERE message.type = 'assistant'
                AND message.time_created >= ${range.from}
                AND message.time_created < ${range.to}
                AND (session.fork_session_id IS NULL OR message.time_created >= session.time_created)
                AND instr(message.data, '"tool"') > 0
                AND json_array_length(message.data, '$.content') > 0
                AND json_extract(content.value, '$.type') = 'tool'
                ${project}
            )
            SELECT
              count(*) AS calls,
              count(*) FILTER (WHERE status = 'completed') AS succeeded,
              count(*) FILTER (WHERE status = 'error') AS failed,
              count(*) FILTER (WHERE status IS NULL OR status NOT IN ('completed', 'error')) AS unfinished
            FROM calls
          `,
            )
            .pipe(
              Effect.orDie,
              Effect.tap((row) =>
                Effect.sync(() => {
                  if (!row) return
                  toolTotals.calls += row.calls
                  toolTotals.succeeded += row.succeeded
                  toolTotals.failed += row.failed
                  toolTotals.unfinished += row.unfinished
                }),
              ),
              Effect.asVoid,
            )
        return db
          .all<ToolRow>(
            sql`
          SELECT
            json_extract(
              part.data,
              '$.name',
              '$.state.status',
              '$.time.completed',
              '$.time.ran',
              '$.time.created'
            ) AS tool
          FROM ${SessionPartTable} AS part
          JOIN ${SessionMessageTable} AS message ON message.id = part.message_id
          JOIN ${SessionTable} AS session ON session.id = message.session_id
          WHERE message.type = 'assistant'
            AND message.time_created >= ${range.from}
            AND message.time_created < ${range.to}
            AND (session.fork_session_id IS NULL OR message.time_created >= session.time_created)
            AND part.type = 'tool'
            ${project}
          UNION ALL
          SELECT
            json_extract(
              content.value,
              '$.name',
              '$.state.status',
              '$.time.completed',
              '$.time.ran',
              '$.time.created'
            ) AS tool
          FROM ${SessionMessageTable} AS message
          JOIN ${SessionTable} AS session ON session.id = message.session_id,
            json_each(message.data, '$.content') AS content
          WHERE message.type = 'assistant'
            AND message.time_created >= ${range.from}
            AND message.time_created < ${range.to}
            AND (session.fork_session_id IS NULL OR message.time_created >= session.time_created)
            AND instr(message.data, '"tool"') > 0
            AND json_array_length(message.data, '$.content') > 0
            AND json_extract(content.value, '$.type') = 'tool'
            ${project}
        `,
          )
          .pipe(
            Effect.orDie,
            Effect.tap((rows) =>
              Effect.sync(() => {
                rows.forEach((row) => {
                  const parsed = parseTool(row.tool)
                  const name = parsed[0]
                  const status = parsed[1]
                  const completed = parsed[2]
                  const started = parsed[3] ?? parsed[4]
                  const duration = completed !== null && started !== null ? completed - started : null
                  addToolStatus(toolTotals, status)
                  if (!name) return
                  const tool = tools.get(name) ?? {
                    name,
                    calls: 0,
                    succeeded: 0,
                    failed: 0,
                    unfinished: 0,
                    durations: [],
                  }
                  tools.set(name, tool)
                  addToolStatus(tool, status)
                  if (duration !== null) tool.durations.push(duration)
                })
              }),
            ),
            Effect.asVoid,
          )
      },
      { concurrency: 1, discard: true },
    )

  const events =
    from >= to
      ? []
      : yield* db
          .select({ data: EventTable.data })
          .from(EventTable)
          // CROSS JOIN keeps `event` as the outer loop so SQLite scans the partial
          // `(created, aggregate_id)` index in the requested range instead of
          // probing every historical session in `project_id`.
          .crossJoin(SessionTable)
          .where(
            and(
              sql`${EventTable.type} = ${UsageRecordedTypeSql}`,
              gte(EventTable.created, from),
              lt(EventTable.created, to),
              eq(SessionTable.id, EventTable.aggregate_id),
              input.projectID === undefined ? undefined : eq(SessionTable.project_id, input.projectID),
              sql`json_extract(${EventTable.data}, '$.source') = 'compaction'`,
            ),
          )
          .all()
          .pipe(Effect.orDie)
  events.forEach((row) => {
    const decoded = decodeUsage(row.data)
    if (Option.isNone(decoded)) return
    addTokens(totals.tokens, decoded.value.tokens)
    totals.cost += decoded.value.cost
  })

  const days = [...activity.entries()].sort(([a], [b]) => a.localeCompare(b))
  return {
    range: { from, to },
    sessions: sessions.size,
    subagents: subagents.size,
    prompts: totals.prompts,
    steps: totals.steps,
    tokens: totals.tokens,
    cost: Money.USD.make(totals.cost),
    tools:
      toolMode === "none"
        ? { mode: toolMode }
        : toolMode === "summary"
          ? { mode: toolMode, totals: toolTotals }
          : {
              mode: toolMode,
              totals: toolTotals,
              usage: [...tools.values()]
                .sort((a, b) => b.calls - a.calls)
                .map((tool) => ({
                  name: tool.name,
                  calls: tool.calls,
                  succeeded: tool.succeeded,
                  failed: tool.failed,
                  unfinished: tool.unfinished,
                  durationP50: median(tool.durations),
                })),
            },
    activeDays: days.length,
    streak: longestStreak(days.map(([date]) => date)),
    activity: days.map(([date, steps]) => ({ date, steps })),
    models: [...models.values()]
      .sort((a, b) => TokenUsage.total(b.tokens) - TokenUsage.total(a.tokens))
      .map((model) => ({ ...model, cost: Money.USD.make(model.cost) })),
  }
})

function parseMetrics(raw: string | null): MessageMetrics {
  if (!raw) return [null, null, null, null, null, null, null, null, null]
  return JSON.parse(raw) as MessageMetrics
}

function parseTool(raw: string | null): ToolTuple {
  if (!raw) return [null, null, null, null, null]
  return JSON.parse(raw) as ToolTuple
}

function windows(from: number, to: number) {
  return Array.from({ length: Math.ceil((to - from) / Window) }, (_, index) => ({
    from: from + index * Window,
    to: Math.min(to, from + (index + 1) * Window),
  }))
}

function rowTokens(metrics: MessageMetrics): Tokens {
  return {
    input: metrics[3] ?? 0,
    output: metrics[4] ?? 0,
    reasoning: metrics[5] ?? 0,
    cache: { read: metrics[6] ?? 0, write: metrics[7] ?? 0 },
  }
}

function emptyTokens(): Tokens {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function addTokens(target: Tokens, source: TokenUsage.Info) {
  target.input += source.input
  target.output += source.output
  target.reasoning += source.reasoning
  target.cache.read += source.cache.read
  target.cache.write += source.cache.write
}

function addToolStatus(
  target: { calls: number; succeeded: number; failed: number; unfinished: number },
  status: string | null,
) {
  target.calls++
  if (status === "completed") {
    target.succeeded++
    return
  }
  if (status === "error") {
    target.failed++
    return
  }
  target.unfinished++
}

function makeDateKey(timezone = "UTC") {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return (time: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map((part) => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  }
}

function longestStreak(days: string[]) {
  return days.reduce(
    (result, day, index) => {
      const previous = days[index - 1]
      const current = previous && dayOrdinal(day) - dayOrdinal(previous) === 1 ? result.current + 1 : 1
      return { current, longest: Math.max(result.longest, current) }
    },
    { current: 0, longest: 0 },
  ).longest
}

function dayOrdinal(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function median(values: number[]) {
  if (values.length === 0) return undefined
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
