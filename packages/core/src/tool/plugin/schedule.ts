export * as ScheduleTools from "./schedule.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { PositiveInt, optional } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { DateTime, Effect, Option, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import PROMPT_SCHEDULE from "../../plugin/command/schedule.txt"
import { Schedule } from "../../schedule.js"

/** A schedule as the model reads it, with times in the schedule's own zone. */
export const View = Schema.Struct({
  id: Schedule.ID,
  name: Schema.String.pipe(optional),
  when: Schedule.When,
  tz: Schema.String,
  if: Schedule.Condition.pipe(optional),
  until: Schedule.Condition.pipe(optional),
  prompt: Schema.String.pipe(optional),
  action: Schedule.Action,
  dedicatedSessionID: Session.ID.pipe(optional),
  activeJobID: Schema.String.pipe(optional),
  status: Schedule.Status,
  nextDueAt: Schema.String.pipe(optional),
  endsAt: Schema.String.pipe(optional),
  remainingRuns: Schema.Number.pipe(optional),
  runCount: Schema.Number,
  lastFiredAt: Schema.String.pipe(optional),
  lastOutcome: Schedule.Outcome.pipe(optional),
  lastOutput: Schema.String.pipe(optional),
})
export type View = typeof View.Type

const ListOutput = Schema.Struct({
  now: Schema.String.annotate({ description: "The current time, in UTC." }),
  schedules: Schema.Array(View),
})

export const IDInput = Schema.Struct({
  id: Schedule.ID.annotate({ description: "Schedule id from schedule_list." }),
})

export const RunView = Schema.Struct({
  id: Schedule.RunID,
  scheduleID: Schedule.ID,
  scheduleName: Schema.String.pipe(optional),
  sessionID: Session.ID.pipe(optional),
  run: PositiveInt,
  status: Schedule.RunStatus,
  attention: Schedule.Attention,
  summary: Schema.String.pipe(optional),
  error: Schema.String.pipe(optional),
  startedAt: Schema.String,
  completedAt: Schema.String.pipe(optional),
  readAt: Schema.String.pipe(optional),
})
export type RunView = typeof RunView.Type

const InboxInput = Schema.Struct({
  includeRead: Schema.Boolean.pipe(optional).annotate({
    description: "Include items already marked read (default: false).",
  }),
  limit: PositiveInt.pipe(optional).annotate({
    description: "Maximum items to return (default: 50).",
  }),
})

const RunsInput = Schema.Struct({
  id: Schedule.ID.pipe(optional).annotate({
    description: "Schedule id to inspect, or omit for all schedules in this session.",
  }),
  limit: PositiveInt.pipe(optional).annotate({
    description: "Maximum runs to return (default: 50).",
  }),
})

const DismissInput = Schema.Struct({
  runID: Schedule.RunID.annotate({ description: "Schedule run id from schedule_inbox or schedule_runs." }),
})

const RunsOutput = Schema.Struct({
  runs: Schema.Array(RunView),
})

const RemoveOutput = Schema.Struct({ id: Schedule.ID, removed: Schema.Boolean })

export const Plugin = {
  id: "opencode.tool.schedule",
  effect: Effect.fn("ScheduleTools.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const schedules = yield* Schedule.Service
    // Internal plugins are not re-run on config changes, so reload the tools and the command instead.
    const loaded = yield* ConfigEntryObserver.observe(
      config,
      ctx.event,
      Effect.andThen(ctx.tool.reload(), ctx.command.reload()),
    )
    const enabled = () => Config.latest(loaded.entries, "experimental")?.schedules === true

    // A request keeps the tools it started with after config reloads, so each call rechecks the flag.
    const allowed = (sessionID: Session.ID) =>
      schedules
        .enabled(sessionID)
        .pipe(Effect.flatMap((on) => (on ? Effect.void : Effect.fail(new Schedule.DisabledError()))))
    // Tools act only on the calling Session's schedules.
    const owned = (id: Schedule.ID, sessionID: Session.ID) =>
      allowed(sessionID).pipe(
        Effect.andThen(schedules.get(id)),
        Effect.filterOrFail(
          (info) => info.sessionID === sessionID,
          () => new Schedule.NotFoundError({ scheduleID: id }),
        ),
      )
    const failure = (error: { readonly message: string }) => new ToolFailure({ message: error.message, error })

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.add({
          name: "schedule_create",
          description:
            "Schedule future or recurring work for this session: a prompt (`target`: `\"same\"`, `\"dedicated\"`, or `\"subagent\"`), a slash `command`, a deterministic shell `run` command, or a Code Mode `code` script, optionally gated by an `if` / `until` check. Returns the schedule with its next run (or `done` immediately if `until` already matches).",
          input: Schedule.Request,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            Schedule.fromRequest(context.sessionID, input).pipe(
              Effect.flatMap((parsed) => schedules.create(parsed)),
              Effect.map((info) => {
                const view = toView(info)
                const prefix =
                  view.status === "done" && view.until !== undefined ? "Matched immediately" : "Scheduled"
                return { output: view, content: `${prefix}: ${summary(view)}` }
              }),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "schedule_list",
          description: "List this session's schedules with their status and next run, and the current time.",
          input: Schema.Struct({}),
          output: ListOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (_, context) =>
            Effect.gen(function* () {
              yield* allowed(context.sessionID)
              const now = DateTime.formatIso(yield* DateTime.now)
              const list = (yield* schedules.list({ sessionID: context.sessionID })).map(toView)
              return {
                output: { now, schedules: list },
                content: [`Now: ${now}`, ...(list.length === 0 ? ["No schedules."] : list.map(summary))].join("\n"),
              }
            }).pipe(Effect.mapError(failure)),
        })
        editor.add({
          name: "schedule_pause",
          description: "Pause a schedule. It keeps its settings and does not fire until resumed.",
          input: IDInput,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            owned(input.id, context.sessionID).pipe(
              Effect.andThen(schedules.pause(input.id)),
              Effect.map((info) => ({ output: toView(info), content: `Paused: ${summary(toView(info))}` })),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "schedule_resume",
          description:
            "Resume a paused schedule. A one-shot that fell due while paused fires once now; a repeating one resumes at its next slot.",
          input: IDInput,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            owned(input.id, context.sessionID).pipe(
              Effect.andThen(schedules.resume(input.id)),
              Effect.map((info) => ({ output: toView(info), content: `Resumed: ${summary(toView(info))}` })),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "schedule_delete",
          description: "Delete a schedule for good.",
          input: IDInput,
          output: RemoveOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            owned(input.id, context.sessionID).pipe(
              Effect.andThen(schedules.remove(input.id)),
              Effect.as({ output: { id: input.id, removed: true }, content: `Deleted schedule ${input.id}.` }),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "schedule_result",
          description:
            "Report the outcome of the current scheduled background run (`attention`: `\"quiet\"`, `\"ready\"`, or `\"needs_you\"`), an optional short `summary`, and an optional `nextIn` duration to override the next firing cadence.",
          input: Schedule.ResultInput,
          output: RunView,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            allowed(context.sessionID).pipe(
              Effect.andThen(schedules.reportResult(context.sessionID, input)),
              Effect.map((run) => {
                const view = toRunView(run)
                return { output: view, content: `Recorded ${view.attention}: ${runSummary(view)}` }
              }),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "schedule_inbox",
          description:
            "List scheduled run results that need attention (`needs_you` first, then `ready`) for this session.",
          input: InboxInput,
          output: RunsOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            allowed(context.sessionID).pipe(
              Effect.andThen(
                schedules.inbox({
                  sessionID: context.sessionID,
                  includeRead: input.includeRead,
                  limit: input.limit,
                }),
              ),
              Effect.map((items) => {
                const runs = items.map(toRunView)
                return {
                  output: { runs },
                  content: runs.length === 0 ? "Schedule inbox is empty." : runs.map(runSummary).join("\n"),
                }
              }),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "schedule_runs",
          description: "List recent run history for a schedule (or all schedules in this session), newest first.",
          input: RunsInput,
          output: RunsOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            (input.id === undefined ? allowed(context.sessionID) : owned(input.id, context.sessionID).pipe(Effect.asVoid)).pipe(
              Effect.andThen(
                schedules.runs({
                  scheduleID: input.id,
                  sessionID: context.sessionID,
                  limit: input.limit,
                }),
              ),
              Effect.map((items) => {
                const runs = items.map(toRunView)
                return {
                  output: { runs },
                  content: runs.length === 0 ? "No schedule runs." : runs.map(runSummary).join("\n"),
                }
              }),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "schedule_dismiss",
          description: "Mark a scheduled run item as read in this session's Inbox.",
          input: DismissInput,
          output: RunView,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            allowed(context.sessionID).pipe(
              Effect.andThen(schedules.getRun(input.runID)),
              Effect.filterOrFail(
                (run) => run.ownerSessionID === context.sessionID,
                () => new Schedule.RunNotFoundError({ runID: input.runID }),
              ),
              Effect.andThen(schedules.markRead(input.runID)),
              Effect.map((run) => {
                const view = toRunView(run)
                return { output: view, content: `Marked read: ${runSummary(view)}` }
              }),
              Effect.mapError(failure),
            ),
        })
      })
      .pipe(Effect.orDie)

    yield* ctx.command.transform((editor) => {
      if (!enabled()) return
      editor.add({
        name: "schedule",
        description: "schedule work for later, or list, pause and delete this session's schedules",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: PROMPT_SCHEDULE.replaceAll("$ARGUMENTS", () => input.prompt.text.trim()),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      })
    })
  }),
}

function clip(value: string, max = 80) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function formatCondition(condition: Schedule.Condition): string {
  switch (condition.type) {
    case "shell":
      return JSON.stringify(condition.run)
    case "code": {
      const first = condition.code
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      return `code ${JSON.stringify(first ? first.slice(0, 60) : "")}`
    }
  }
}

function formatAction(action: Schedule.Action): string {
  switch (action.type) {
    case "prompt":
      return action.thread === "dedicated"
        ? `dedicated prompt: ${JSON.stringify(clip(action.prompt))}`
        : `prompt: ${JSON.stringify(clip(action.prompt))}`
    case "subagent":
      return `subagent${action.agent ? ` (${action.agent})` : ""}: ${JSON.stringify(clip(action.prompt))}`
    case "command": {
      const target = action.target ?? "subagent"
      const text = action.arguments?.trim() ? `/${action.command} ${action.arguments.trim()}` : `/${action.command}`
      return `command (${target}): ${JSON.stringify(clip(text))}`
    }
    case "shell":
      return `run: ${JSON.stringify(clip(action.run))}`
    case "code": {
      const first = action.code
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      return `code: ${JSON.stringify(clip(first ?? "", 60))}`
    }
  }
}

/** One line per schedule, for models that read tool content rather than output (Code Mode off). */
function summary(view: View) {
  const when = view.when
  const trigger =
    when.type === "in"
      ? `in ${when.in}`
      : when.type === "at"
        ? `at ${when.at}`
        : when.type === "every"
          ? `every ${when.every}`
          : `cron "${when.cron}"`
  const gate =
    view.until !== undefined
      ? `until ${formatCondition(view.until)}`
      : view.if !== undefined
        ? `if ${formatCondition(view.if)}`
        : undefined
  return [
    `${view.id}${view.name ? ` "${view.name}"` : ""}: ${trigger} (${view.tz})`,
    gate,
    view.status,
    view.nextDueAt && `next ${view.nextDueAt}`,
    formatAction(view.action),
    view.lastOutput && `output: ${JSON.stringify(view.lastOutput)}`,
  ]
    .filter(Boolean)
    .join(", ")
}

function toView(info: Schedule.Info): View {
  const local = (time: DateTime.Utc | undefined) => {
    if (time === undefined) return undefined
    return Option.match(DateTime.zoneMakeNamed(info.tz), {
      onNone: () => DateTime.formatIso(time),
      onSome: (zone) => DateTime.formatIsoOffset(DateTime.setZone(time, zone)),
    })
  }
  const prompt =
    info.action.type === "prompt" || info.action.type === "subagent" ? info.action.prompt : undefined
  return {
    id: info.id,
    name: info.name,
    when: info.when,
    tz: info.tz,
    if: info.if,
    until: info.until,
    ...(prompt === undefined ? {} : { prompt }),
    action: info.action,
    dedicatedSessionID: info.dedicatedSessionID,
    activeJobID: info.activeJobID,
    status: info.status,
    nextDueAt: local(info.nextDueAt),
    endsAt: local(info.endsAt),
    remainingRuns: info.remainingRuns,
    runCount: info.runCount,
    lastFiredAt: local(info.lastFiredAt),
    lastOutcome: info.lastOutcome,
    lastOutput: info.lastOutput,
  }
}

function toRunView(run: Schedule.Run): RunView {
  return {
    id: run.id,
    scheduleID: run.scheduleID,
    scheduleName: run.scheduleName,
    sessionID: run.sessionID,
    run: run.run,
    status: run.status,
    attention: run.attention,
    summary: run.summary,
    error: run.error,
    startedAt: DateTime.formatIso(run.startedAt),
    completedAt: run.completedAt === undefined ? undefined : DateTime.formatIso(run.completedAt),
    readAt: run.readAt === undefined ? undefined : DateTime.formatIso(run.readAt),
  }
}

function runSummary(run: RunView) {
  const label = run.scheduleName ? `"${run.scheduleName}"` : run.scheduleID
  const detail = run.summary ?? run.error
  return [
    `${run.id} (${label} #${run.run})`,
    run.status,
    run.attention,
    run.startedAt,
    detail && JSON.stringify(clip(detail, 120)),
  ]
    .filter(Boolean)
    .join(", ")
}
