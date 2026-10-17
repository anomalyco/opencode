export * as LoopPlugin from "./loop.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { Cause, Clock, Duration, Effect, FiberMap, Predicate, Stream } from "effect"
import { Bus } from "../bus.js"
import { SessionEvent } from "../session/event.js"

const usage = "Usage: /loop [interval] <prompt>, e.g. /loop 5m check the deploy"
// Same bounds as Claude Code's recurring tasks: minute granularity, gone after a week.
const minimum = Duration.minutes(1)
const lifetime = Duration.days(7)
const intervalRegex = /^\s*([1-9]\d*)([smh])(?:\s+|$)/
const units = { s: 1, m: 60, h: 3600 }

export function parse(text: string) {
  if (text.trim() === "stop") return { type: "stop" as const }
  const interval = text.match(intervalRegex)
  const prompt = text.slice(interval?.[0].length ?? 0).trim()
  const command = prompt.startsWith("/") ? prompt.slice(1).split(/\s/, 1)[0] : undefined
  if (!prompt || command === "" || command === "loop") return
  return {
    type: "start" as const,
    every: interval
      ? Duration.seconds(Number(interval[1]) * units[interval[2] as keyof typeof units])
      : Duration.minutes(10),
    label: interval ? `${interval[1]}${interval[2]}` : "10m",
    prompt,
    command: command && { name: command, text: prompt.slice(command.length + 1).trim() },
  }
}

function message(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  if (error instanceof Error) return error.message
  if (Predicate.hasProperty(error, "message") && typeof error.message === "string") return error.message
  return String(error)
}

export const Plugin = define({
  id: "opencode.loop",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loops = yield* FiberMap.make<Session.ID>()
    const busy = new Set<Session.ID>()

    // Shown in the session, so a loop never starts or stops without the user seeing it.
    const notify = (sessionID: Session.ID, text: string) =>
      ctx.session
        .synthetic({ sessionID, text, description: text, metadata: { source: "loop" }, resume: false })
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to post loop notice", { sessionID, cause })))
    const stop = (sessionID: Session.ID, text: string) =>
      Effect.gen(function* () {
        if (!(yield* FiberMap.has(loops, sessionID))) return false
        yield* FiberMap.remove(loops, sessionID)
        yield* notify(sessionID, text)
        return true
      })

    yield* bus
      .subscribe([
        SessionEvent.Execution.Started,
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        SessionEvent.Execution.Interrupted,
      ])
      .pipe(
        Stream.runForEach((event) => {
          const sessionID = event.data.sessionID
          if (event.type === SessionEvent.Execution.Started.type) return Effect.sync(() => busy.add(sessionID))
          busy.delete(sessionID)
          // interrupting the session also ends its loop
          if (event.type === SessionEvent.Execution.Interrupted.type && event.data.reason === "user")
            return stop(sessionID, "Loop stopped because the session was interrupted.")
          return Effect.void
        }),
        Effect.forkScoped({ startImmediately: true }),
      )

    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "loop",
        description: "repeat a prompt on an interval: [5m] <prompt>, or stop",
        execute: (input) =>
          Effect.gen(function* () {
            const parsed = parse(input.prompt.text)
            if (!parsed) return yield* Effect.fail(new Error(usage))
            if (parsed.type === "stop") {
              if (yield* stop(input.sessionID, "Loop stopped.")) return
              return yield* Effect.fail(new Error("No loop is running in this session."))
            }
            if (Duration.isLessThan(parsed.every, minimum))
              return yield* Effect.fail(new Error("The loop interval must be at least 1m."))
            const step = (delivery: typeof input.delivery) =>
              parsed.command
                ? ctx.session.command({
                    sessionID: input.sessionID,
                    name: parsed.command.name,
                    text: parsed.command.text,
                    delivery,
                  })
                : ctx.session
                    .prompt({ ...input.prompt, sessionID: input.sessionID, text: parsed.prompt, delivery })
                    .pipe(Effect.asVoid)
            const run = Effect.gen(function* () {
              const end = (yield* Clock.currentTimeMillis) + Duration.toMillis(lifetime)
              while (true) {
                yield* Effect.sleep(parsed.every)
                if ((yield* Clock.currentTimeMillis) >= end)
                  return yield* notify(input.sessionID, "Loop ended after 7 days. Run /loop again to restart it.")
                // Ticks that land while the session is busy are skipped rather than queued.
                if (!busy.has(input.sessionID)) yield* step("queue")
              }
            }).pipe(
              Effect.catchCauseIf(
                (cause) => !Cause.hasInterruptsOnly(cause),
                (cause) => notify(input.sessionID, `Loop stopped: ${message(cause)}`),
              ),
            )
            yield* notify(
              input.sessionID,
              `Loop started: every ${parsed.label} for up to 7 days: ${parsed.prompt}. Run /loop stop to end it.`,
            )
            yield* FiberMap.run(loops, input.sessionID, run)
            yield* step(input.delivery).pipe(
              Effect.tapCause((cause) => stop(input.sessionID, `Loop stopped: ${message(cause)}`)),
            )
          }),
      })
    })
  }),
})
