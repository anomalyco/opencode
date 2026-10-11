export * as LoopPlugin from "./loop.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { Duration, Effect, FiberMap, Stream } from "effect"
import { Bus } from "../bus.js"
import { SessionEvent } from "../session/event.js"

const usage = "Usage: /loop [interval] <prompt>, e.g. /loop 5m check the deploy"
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
    prompt,
    command: command && { name: command, text: prompt.slice(command.length + 1).trim() },
  }
}

export const Plugin = define({
  id: "opencode.loop",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loops = yield* FiberMap.make<Session.ID>()
    const busy = new Set<Session.ID>()

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
            return FiberMap.remove(loops, sessionID)
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
            if (parsed.type === "stop") return yield* FiberMap.remove(loops, input.sessionID)
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
            // Ticks that land while the session is busy are skipped rather than queued.
            yield* Effect.suspend(() => (busy.has(input.sessionID) ? Effect.void : step("queue"))).pipe(
              Effect.delay(parsed.every),
              Effect.forever,
              Effect.catchCause((cause) => Effect.logError("loop stopped", { sessionID: input.sessionID, cause })),
              FiberMap.run(loops, input.sessionID),
            )
            yield* step(input.delivery).pipe(Effect.onError(() => FiberMap.remove(loops, input.sessionID)))
          }),
      })
    })
  }),
})
