export * as WarmingPlugin from "./warming.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { Model } from "@opencode/schema/model"
import type { Session } from "@opencode/schema/session"
import { Clock, Duration, Effect, Scope, Stream } from "effect"
import { Config } from "../config.js"
import { resolveModel } from "./optimize.js"

const defaults = {
  prompt: "This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK",
  interval: Duration.minutes(4),
  duration: Duration.minutes(30),
}

export const Plugin = define({
  id: "opencode.warming",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const autoInterval = Effect.fn("WarmingPlugin.autoInterval")(function* (event: SessionHooks["context"]) {
      const model: Model.Info | undefined = yield* resolveModel(ctx, event).pipe(Effect.orElseSucceed(() => undefined))
      const ttl = cacheTTL(model?.settings?.cache?.ttl)
      return ttl === undefined ? undefined : Duration.millis(ttl * 0.9)
    })
    const loadSettings = Effect.fn("WarmingPlugin.loadSettings")(function* (event: SessionHooks["context"]) {
      const warming = Config.latest(yield* config.entries(), "warming")
      if (!warming) return
      const configured = warming === true ? defaults : { ...defaults, ...warming }
      const interval = configured.interval === "auto" ? yield* autoInterval(event) : configured.interval
      // "auto" pings just before the model's cache expires; a model without a known cache lifetime isn't warmed.
      if (interval === undefined) return
      const settings = { ...configured, interval }
      const millis = Duration.toMillis(settings.interval)
      const duration = Duration.toMillis(settings.duration)
      if (Number.isFinite(millis) && millis > 0 && Number.isFinite(duration) && duration > 0) return settings
      yield* Effect.logWarning("warming interval and duration must be finite positive durations")
    })

    const scope = yield* Scope.Scope
    const sessions = new Map<Session.ID, { last: number; expires: number; settings: typeof defaults }>()
    // A ping during a model request would compete with the request it keeps warm, which stalls single-slot local models.
    // A request counts from its context hook, because `session.step.started` waits for the first response chunk.
    const requesting = new Set<Session.ID>()
    // A turn always ends with an execution event, so a step that ends without its own event can't stay in flight.
    yield* ctx.event
      .subscribe({
        types: [
          "session.step.streamed",
          "session.step.failed",
          "session.execution.succeeded",
          "session.execution.failed",
          "session.execution.interrupted",
        ],
      })
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            requesting.delete(event.data.sessionID)
            // Count the next interval from the end of the response, not from when a long request started.
            const current = sessions.get(event.data.sessionID)
            if (current) current.last = yield* Clock.currentTimeMillis
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    const loop: (sessionID: Session.ID) => Effect.Effect<void> = Effect.fn("WarmingPlugin.loop")(
      function* (sessionID) {
        const current = sessions.get(sessionID)
        if (!current) return

        const now = yield* Clock.currentTimeMillis
        const next = Math.min(current.last + Duration.toMillis(current.settings.interval), current.expires)
        if (now < next) {
          yield* Effect.sleep(Duration.millis(next - now))
          return yield* loop(sessionID)
        }
        if (now >= current.expires) {
          sessions.delete(sessionID)
          return
        }
        if (requesting.has(sessionID)) {
          yield* Effect.sleep(current.settings.interval)
          return yield* loop(sessionID)
        }

        const last = current.last
        yield* Effect.logInfo("warming session", { sessionID, last })
        yield* ctx.session
          .generate({ sessionID, prompt: current.settings.prompt })
          .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to warm session", { sessionID, cause })))
        const latest = sessions.get(sessionID)
        if (latest === current && latest.last === last) latest.last = yield* Clock.currentTimeMillis
        return yield* loop(sessionID)
      },
    )

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)
        if (session.parentID) return

        const active = sessions.get(event.sessionID)
        const settings = yield* loadSettings(event)
        if (!settings) {
          sessions.delete(event.sessionID)
          return
        }

        // Once generate exposes request metadata to context hooks, tag warm requests instead of matching the prompt.
        const message = event.messages.at(-1)
        if (
          message?.role === "user" &&
          message.content.length === 1 &&
          message.content[0]?.type === "text" &&
          (message.content[0].text === active?.settings.prompt || message.content[0].text === settings.prompt)
        ) {
          if (active) active.settings = settings
          return
        }

        const now = yield* Clock.currentTimeMillis
        const duration = Duration.toMillis(settings.duration)
        if (active) {
          active.last = now
          active.expires = now + duration
          active.settings = settings
          return
        }
        sessions.set(event.sessionID, { last: now, expires: now + duration, settings })
        yield* Effect.logInfo("scheduled session warming", {
          sessionID: event.sessionID,
          interval: settings.interval,
          expires: now + duration,
        })
        yield* loop(event.sessionID).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("session warming loop failed", { sessionID: event.sessionID, cause }),
          ),
          Effect.forkIn(scope),
        )
      })
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => requesting.add(event.sessionID)).pipe(Effect.andThen(hook(event))),
    )
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})

const units = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Milliseconds in a cache TTL such as "5m" or "1h". */
function cacheTTL(ttl: string | undefined) {
  const match = ttl?.match(/^(\d+)(ms|s|m|h|d)$/)
  return match ? Number(match[1]) * units[match[2] as keyof typeof units] : undefined
}
