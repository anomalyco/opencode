export * as ScheduleTools from "./schedule.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { optional } from "@opencode/schema/schema"
import type { Session } from "@opencode/schema/session"
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
  prompt: Schema.String,
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
            "Schedule a prompt that wakes this session later: once after a delay, at a time, every interval, on a cron, or gated by an `if` / `until` shell (`{ run }`) or Code Mode (`{ code }`) check. Returns the schedule with its next run (or `done` immediately if `until` already matches).",
          input: Schedule.Request,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            schedules.create(Schedule.toCreateInput(context.sessionID, input)).pipe(
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
      })
      .pipe(Effect.orDie)

    yield* ctx.command.transform((editor) => {
      if (!enabled()) return
      editor.add({
        name: "schedule",
        description: "schedule a prompt for later, or list, pause and delete this session's schedules",
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
  const prompt = view.prompt.length > 80 ? `${view.prompt.slice(0, 79)}…` : view.prompt
  return [
    `${view.id}${view.name ? ` "${view.name}"` : ""}: ${trigger} (${view.tz})`,
    gate,
    view.status,
    view.nextDueAt && `next ${view.nextDueAt}`,
    `prompt: ${JSON.stringify(prompt)}`,
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
  return {
    id: info.id,
    name: info.name,
    when: info.when,
    tz: info.tz,
    if: info.if,
    until: info.until,
    prompt: info.action.prompt,
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
