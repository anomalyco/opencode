export * as WarmingPlugin from "./warming.js"

import { LLMClient, keepAlive } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { Session } from "@opencode/schema/session"
import { ConfigWarming } from "@opencode/schema/config/warming"
import { Clock, Duration, Effect, FiberMap, Option, Schema, Stream } from "effect"
import { Config } from "../config.js"
import { SessionWarmup } from "../session/warmup.js"
import { resolveModel } from "./optimize.js"

const decodeWarming = Schema.decodeUnknownOption(ConfigWarming.Warming)

const defaults = {
  interval: "auto" as Duration.Duration | "auto",
  duration: Duration.minutes(30),
  // Once a turn ends, the chance that the next prompt arrives within one more interval falls below what a refresh
  // costs after about three refreshes, so an idle Session stops sooner than a running turn.
  idle: Duration.minutes(15),
}

type Settings = typeof defaults

interface Entry {
  settings: Settings
  // When the provider last read the cached prompt: the step request's or a refresh's send time. The cache lifetime runs
  // from there, not from the end of a long response.
  touched: number
  expires: number
}

// A refresh that reaches the provider this close to expiry may find the entry gone and rewrite the whole prompt.
const EXPIRY_MARGIN = Duration.seconds(10)
// How often to look again while a model request runs. The interval comes from the request the step sends, which is
// recorded once its context hook returns, and the request may end the turn after the entry has expired.
const BUSY_POLL = Duration.seconds(5)

export const Plugin = define({
  id: "opencode.warming",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const llm = yield* LLMClient.Service
    const warmup = yield* SessionWarmup.Service
    // A model's or provider's `cache.warming` overrides the top-level `warming`.
    const loadSettings = Effect.fn("WarmingPlugin.loadSettings")(function* (event: SessionHooks["context"]) {
      // Warming must never fail the request it hooks, so an unreadable catalog falls back to the top-level setting.
      const cache = (yield* resolveModel(ctx, event).pipe(Effect.orElseSucceed(() => undefined)))?.settings?.cache
      const local = cache?.warming === undefined ? undefined : Option.getOrUndefined(decodeWarming(cache.warming))
      if (cache?.warming !== undefined && local === undefined)
        yield* Effect.logWarning("invalid cache.warming setting; using the top-level warming setting", {
          model: event.model,
        })
      const global = Config.latest(yield* config.entries(), "warming")
      if (!(local ?? global)) return
      const settings: Settings = {
        ...defaults,
        ...(typeof global === "object" ? global : {}),
        ...(typeof local === "object" ? local : {}),
      }
      const valid =
        Duration.isFinite(settings.duration) &&
        Duration.isGreaterThan(settings.duration, Duration.zero) &&
        Duration.isFinite(settings.idle) &&
        Duration.isGreaterThan(settings.idle, Duration.zero) &&
        (settings.interval === "auto" ||
          (Duration.isGreaterThan(settings.interval, Duration.zero) &&
            Duration.isLessThan(settings.interval, settings.duration)))
      if (valid) return settings
      yield* Effect.logWarning(
        "warming interval must be positive and shorter than a finite duration, and idle must be finite",
        settings,
      )
    })

    const sessions = new Map<Session.ID, Entry>()
    // One loop per Session. Each step request restarts it, so it always times from that request's cache lifetime.
    const loops = yield* FiberMap.make<Session.ID>()
    // A refresh during a model request would compete with the request it keeps warm.
    // A request counts from its context hook, because `session.step.started` waits for the first response chunk.
    const requesting = new Set<Session.ID>()

    /** Ends warming from inside the Session's loop, which returns afterwards. */
    const settle = Effect.fn("WarmingPlugin.settle")(function* (sessionID: Session.ID, reason?: string) {
      sessions.delete(sessionID)
      yield* warmup.forget(sessionID)
      if (reason) yield* Effect.logInfo("stopped session warming", { sessionID, reason })
    })
    /** Ends warming from outside the Session's loop. */
    const stop = (sessionID: Session.ID) => settle(sessionID).pipe(Effect.andThen(FiberMap.remove(loops, sessionID)))

    // A turn always ends with an execution event, so a step that ends without its own event can't stay in flight.
    yield* ctx.event
      .subscribe({
        types: [
          "session.step.streamed",
          "session.step.failed",
          "session.execution.succeeded",
          "session.execution.failed",
          "session.execution.interrupted",
          "session.compaction.ended",
        ],
      })
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            // A compaction replaces the prompt the next step sends, so the cached one is no longer worth keeping, unless
            // a step request has already armed warming again since.
            if (event.type === "session.compaction.ended") {
              const current = sessions.get(event.data.sessionID)
              if (current && current.touched > event.created) return
              return yield* stop(event.data.sessionID)
            }
            requesting.delete(event.data.sessionID)
            if (!event.type.startsWith("session.execution.")) return
            const current = sessions.get(event.data.sessionID)
            if (!current) return
            const now = yield* Clock.currentTimeMillis
            current.expires = Math.min(current.expires, now + Duration.toMillis(current.settings.idle))
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

    const loop: (sessionID: Session.ID) => Effect.Effect<void> = Effect.fn("WarmingPlugin.loop")(function* (sessionID) {
      const current = sessions.get(sessionID)
      if (!current) return
      const now = yield* Clock.currentTimeMillis
      if (now >= current.expires) return yield* settle(sessionID)
      if (requesting.has(sessionID)) {
        yield* Effect.sleep(BUSY_POLL)
        return yield* loop(sessionID)
      }

      const sent = yield* warmup.latest(sessionID)
      const refresh = sent && keepAlive(sent.request)
      const ttl = refresh && parseTTL(refresh.ttl)
      // Routes that cache implicitly, or whose thinking budget follows the output limit, aren't refreshed.
      if (!sent || !refresh || ttl === undefined) return yield* settle(sessionID)
      const interval = current.settings.interval === "auto" ? ttl * 0.9 : Duration.toMillis(current.settings.interval)
      const due = current.touched + interval
      if (now < due) {
        yield* Effect.sleep(Duration.millis(Math.min(due, current.expires) - now))
        return yield* loop(sessionID)
      }
      if (now >= current.touched + ttl - Duration.toMillis(EXPIRY_MARGIN))
        return yield* settle(sessionID, "the cache entry has expired")

      current.touched = now
      yield* Effect.logInfo("warming session", { sessionID })
      const usage = yield* llm.generate(refresh.request, sent.options).pipe(
        Effect.map((response) => response.usage),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to warm session", { sessionID, cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (!usage) return yield* settle(sessionID, "the refresh failed")
      // A refresh that read nothing or wrote anything found the entry gone; each further one would rewrite it.
      if (!(usage.cacheReadInputTokens ?? 0) || (usage.cacheWriteInputTokens ?? 0) > 0)
        return yield* settle(sessionID, "the refresh missed the cache")
      return yield* loop(sessionID)
    })

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        requesting.add(event.sessionID)
        const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)
        // Subagents finish and are rarely resumed; their parent stays warm while it waits on them.
        if (session.parentID) return
        const settings = yield* loadSettings(event)
        if (!settings) return yield* stop(event.sessionID)

        yield* warmup.watch(event.sessionID)
        const now = yield* Clock.currentTimeMillis
        const expires = now + Duration.toMillis(settings.duration)
        if (!sessions.has(event.sessionID))
          yield* Effect.logInfo("scheduled session warming", { sessionID: event.sessionID, expires })
        sessions.set(event.sessionID, { settings, touched: now, expires })
        yield* FiberMap.run(
          loops,
          event.sessionID,
          loop(event.sessionID).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("session warming loop failed", { sessionID: event.sessionID, cause }),
            ),
          ),
        )
      }),
    )
  }),
})

const units = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Milliseconds in a cache lifetime such as "5m". */
function parseTTL(ttl: string) {
  const match = ttl.match(/^(\d+)(ms|s|m|h|d)$/)
  if (match) return Number(match[1]) * units[match[2] as keyof typeof units]
}
