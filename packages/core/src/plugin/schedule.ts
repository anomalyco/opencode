export * as SchedulePlugin from "./schedule.js"

import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Clock, Effect, Schema } from "effect"
import { SessionSchedule } from "../session/schedule.js"

const CreateInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "Message delivered to this session as a new user message when the schedule fires. Write a complete, self-contained instruction.",
  }),
  every: Schema.optionalKey(Schema.String).annotate({
    description: "Repeat interval such as 30s, 15m, 2h or 1d. Without `at`, the first run is one interval from now.",
  }),
  at: Schema.optionalKey(Schema.String).annotate({
    description:
      "ISO 8601 timestamp with a timezone offset, e.g. 2026-09-29T15:00:00-04:00. Alone it schedules a single run; with `every` it sets the first run.",
  }),
})

const CancelInput = Schema.Struct({
  id: Schema.String.annotate({ description: "Schedule ID returned by schedule_create or schedule_list." }),
})

const View = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  next: Schema.String.annotate({ description: "Next run as an ISO 8601 timestamp." }),
  every: Schema.optionalKey(Schema.String).annotate({ description: "Repeat interval; absent for a single run." }),
})

const ListOutput = Schema.Struct({
  now: Schema.String.annotate({ description: "Current server time as an ISO 8601 timestamp." }),
  schedules: Schema.Array(View),
})

const view = (info: SessionSchedule.Info) => ({
  id: info.id,
  prompt: info.text,
  next: new Date(info.next).toISOString(),
  ...(info.every === undefined ? {} : { every: `${info.every / 1000}s` }),
})

export const Plugin = define({
  id: "opencode.schedule",
  effect: Effect.fn(function* (ctx) {
    const schedule = yield* SessionSchedule.Service

    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "schedule",
        description: "repeat a prompt in this session: <30s|15m|2h> <prompt>, or off",
        execute: (input) =>
          Effect.gen(function* () {
            const text = input.prompt.text.trim()
            if (text === "off") {
              const existing = yield* schedule.list(input.sessionID)
              return yield* Effect.forEach(existing, (info) => schedule.cancel(info.id), { discard: true })
            }
            const [interval = "", ...rest] = text.split(/\s+/)
            const every = SessionSchedule.parseInterval(interval)
            const prompt = rest.join(" ")
            if (every === undefined || !prompt)
              return yield* Effect.fail(new Error("Usage: /schedule <30s|15m|2h> <prompt>, or /schedule off"))
            yield* schedule.create({ sessionID: input.sessionID, text: prompt, every })
          }),
      })
    })

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "schedule_create",
          description:
            "Schedule a prompt to be sent back to the current session later, even if no client has it open. Use `every` for recurring checks (e.g. every 15m), `at` for a single run at an absolute time, or both. Returns the schedule ID.",
          input: CreateInput,
          output: View,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.every === undefined && input.at === undefined)
                return yield* new ToolFailure({ message: "Provide `every`, `at`, or both" })
              const every = input.every === undefined ? undefined : SessionSchedule.parseInterval(input.every)
              if (input.every !== undefined && every === undefined)
                return yield* new ToolFailure({ message: `Invalid interval ${input.every}; use e.g. 30s, 15m, 2h, 1d` })
              const at = input.at === undefined ? undefined : Date.parse(input.at)
              const now = yield* Clock.currentTimeMillis
              if (at !== undefined && Number.isNaN(at))
                return yield* new ToolFailure({ message: `Invalid timestamp ${input.at}` })
              if (at !== undefined && at <= now)
                return yield* new ToolFailure({
                  message: `${input.at} is in the past; the current time is ${new Date(now).toISOString()}`,
                })
              const info = yield* schedule.create({ sessionID: context.sessionID, text: input.prompt, at, every })
              return {
                output: view(info),
                content: `Scheduled ${info.id}: next run ${view(info).next}${every ? `, then every ${input.every}` : ""}.`,
              }
            }),
        })
        editor.add({
          name: "schedule_list",
          description: "List the prompts scheduled for the current session, with the current server time.",
          input: Schema.Struct({}),
          output: ListOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (_input, context) =>
            Effect.gen(function* () {
              const infos = yield* schedule.list(context.sessionID)
              return {
                output: {
                  now: new Date(yield* Clock.currentTimeMillis).toISOString(),
                  schedules: infos.map(view),
                },
              }
            }),
        })
        editor.add({
          name: "schedule_cancel",
          description: "Cancel a scheduled prompt in the current session.",
          input: CancelInput,
          output: Schema.Struct({ id: Schema.String }),
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const owned = (yield* schedule.list(context.sessionID)).some((info) => info.id === input.id)
              if (!owned) return yield* new ToolFailure({ message: `No schedule ${input.id} in this session` })
              yield* schedule.cancel(input.id)
              return { output: { id: input.id }, content: `Cancelled ${input.id}.` }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
})
