export * as AutomationTools from "./automation.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { optional } from "@opencode/schema/schema"
import { DateTime, Effect, Option, Schema } from "effect"
import { Automation } from "../../automation.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import PROMPT_AUTOMATION from "../../plugin/command/automation.txt"
import { Session } from "../../session.js"
import type { SessionSchema } from "../../session/schema.js"

/** An automation as the model reads it, with times in the automation's own zone. */
export const View = Schema.Struct({
  id: Automation.ID,
  name: Schema.String,
  trigger: Automation.Trigger,
  tz: Schema.String,
  action: Automation.Action,
  status: Automation.Status,
  nextDueAt: Schema.String.pipe(optional),
  expires: Schema.String.pipe(optional),
  runCount: Schema.Number,
  lastRunAt: Schema.String.pipe(optional),
  lastOutcome: Automation.Outcome.pipe(optional),
  lastOutput: Schema.String.pipe(optional),
  state: Schema.Json.pipe(optional),
})
export type View = typeof View.Type

const ListOutput = Schema.Struct({
  now: Schema.String.annotate({ description: "The current time, in UTC." }),
  automations: Schema.Array(View),
})

export const IDInput = Schema.Struct({
  id: Automation.ID.annotate({ description: "Automation id from automation_list." }),
})

const RemoveOutput = Schema.Struct({ id: Automation.ID, removed: Schema.Boolean })

export const Plugin = {
  id: "opencode.tool.automation",
  effect: Effect.fn("AutomationTools.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const automations = yield* Automation.Service
    const sessions = yield* Session.Service
    // Internal plugins are not re-run on config changes, so reload the tools and the command instead.
    const loaded = yield* ConfigEntryObserver.observe(
      config,
      ctx.event,
      Effect.andThen(ctx.tool.reload(), ctx.command.reload()),
    )
    const flags = yield* Flag.Service
    const enabled = () => flags.resolve(loaded.entries).automations.enabled

    // A request keeps the tools it started with after config reloads, so each call rechecks the flag where the
    // calling Session lives, and returns that Session for scoping.
    const caller = (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const session = yield* sessions.get(sessionID)
        const on = yield* automations
          .enabled(session.location.directory)
          .pipe(Effect.catchTag("FileSystem.DirectoryNotFoundError", () => Effect.succeed(false)))
        if (!on) return yield* new Automation.DisabledError()
        return session
      })
    // Tools act only on automations in the calling Session's project.
    const owned = (id: Automation.ID, sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const session = yield* caller(sessionID)
        const info = yield* automations.get(id)
        if (info.projectID !== session.projectID) return yield* new Automation.NotFoundError({ automationID: id })
        return info
      })
    const failure = (error: { readonly message: string }) => new ToolFailure({ message: error.message, error })

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.add({
          name: "automation_create",
          description:
            "Schedule a prompt or a Code Mode check in this project. A prompt can target this session, another session or a new subagent child. A code string runs without a model. Return at most one send per run: { send: { prompt } } steers this session; add to: { subagent } inside send for a permitted quiet child. Omit send to stay quiet. Returns the automation with its next run.",
          input: Automation.Request,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            automations
              .create({ ...input, sessionID: context.sessionID }, Permission.invocation(context))
              .pipe(Effect.map(changed("Created")), Effect.mapError(failure)),
        })
        editor.add({
          name: "automation_list",
          description: "List this project's automations with their status and next run, and the current time.",
          input: Schema.Struct({}),
          output: ListOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (_, context) =>
            Effect.gen(function* () {
              const session = yield* caller(context.sessionID)
              const now = DateTime.formatIso(yield* DateTime.now)
              const list = (yield* automations.list({ projectID: session.projectID })).map(toView)
              return {
                output: { now, automations: list },
                content: [`Now: ${now}`, ...(list.length === 0 ? ["No automations."] : list.map(summary))].join("\n"),
              }
            }).pipe(Effect.mapError(failure)),
        })
        editor.add({
          name: "automation_pause",
          description: "Pause an automation. It keeps its settings and does not run until resumed.",
          input: IDInput,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            owned(input.id, context.sessionID).pipe(
              Effect.andThen(automations.pause(input.id)),
              Effect.map(changed("Paused")),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "automation_resume",
          description:
            "Resume a paused automation. An `at` automation that fell due while paused runs once now; a repeating one resumes at its next slot.",
          input: IDInput,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            owned(input.id, context.sessionID).pipe(
              Effect.andThen(automations.resume(input.id)),
              Effect.map(changed("Resumed")),
              Effect.mapError(failure),
            ),
        })
        editor.add({
          name: "automation_delete",
          description: "Delete an automation for good.",
          input: IDInput,
          output: RemoveOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            owned(input.id, context.sessionID).pipe(
              Effect.andThen(automations.remove(input.id)),
              Effect.as({ output: { id: input.id, removed: true }, content: `Deleted automation ${input.id}.` }),
              Effect.mapError(failure),
            ),
        })
      })
      .pipe(Effect.orDie)

    yield* ctx.command.transform((editor) => {
      if (!enabled()) return
      editor.add({
        name: "automation",
        description: "create an automation, or list, pause, resume and delete this project's automations",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: PROMPT_AUTOMATION.replaceAll("$ARGUMENTS", () => input.prompt.text.trim()),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      })
    })
  }),
}

/** What a tool returns for the automation it created, paused or resumed. */
function changed(verb: string) {
  return (info: Automation.Info) => {
    const view = toView(info)
    return { output: view, content: `${verb}: ${summary(view)}` }
  }
}

/** One line per automation, for models that read tool content rather than output (Code Mode off). */
function summary(view: View) {
  const trigger =
    view.trigger.type === "at"
      ? `at ${view.trigger.at}`
      : view.trigger.type === "every"
        ? `every ${view.trigger.every}`
        : view.trigger.type === "cron"
          ? `cron "${view.trigger.cron}"`
          : `on ${view.trigger.server} ${view.trigger.event}`
  const action =
    view.action.type === "prompt"
      ? `prompt ${view.action.to.session ?? `subagent ${view.action.to.subagent}`}: ${JSON.stringify(clip(view.action.prompt))}`
      : `code: ${JSON.stringify(
          clip(
            view.action.code
              .split("\n")
              .find((line) => line.trim() !== "")
              ?.trim() ?? "",
          ),
        )}`
  return [
    `${view.id} "${view.name}": ${trigger} (${view.tz})`,
    view.status,
    view.nextDueAt && `next ${view.nextDueAt}`,
    view.expires && `expires ${view.expires}`,
    action,
    view.lastOutput && `output: ${JSON.stringify(clip(view.lastOutput))}`,
  ]
    .filter(Boolean)
    .join(", ")
}

function clip(text: string) {
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

function toView(info: Automation.Info): View {
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
    trigger: info.trigger,
    tz: info.tz,
    action: info.action,
    status: info.status,
    nextDueAt: local(info.nextDueAt),
    expires: local(info.expires),
    runCount: info.runCount,
    lastRunAt: local(info.lastRunAt),
    lastOutcome: info.lastOutcome,
    lastOutput: info.lastOutput,
    state: info.state,
  }
}
