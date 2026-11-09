export * as WarmingPlugin from "./warming.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { Provider } from "@opencode/schema/provider"
import type { Session } from "@opencode/schema/session"
import { ConfigWarming } from "@opencode/schema/config/warming"
import { Clock, Data, Deferred, Duration, Effect, Option, Schema, Scope, Stream } from "effect"
import { Config } from "../config.js"
import { resolveModel } from "./optimize.js"

const decodeWarming = Schema.decodeUnknownOption(ConfigWarming.Warming)

const defaults = {
  prompt: "This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK",
  interval: "auto" as "auto" | Duration.Duration,
  duration: Duration.minutes(30),
}

/** `ttl` is how long the provider keeps a cache entry after the request that last sent it. */
type Settings = typeof defaults & { interval: Duration.Duration; ttl: Duration.Duration }

/** Whether a session is warmed after a request, and why not. */
type Decision = Data.TaggedEnum<{
  Warm: { readonly settings: Settings }
  /** Neither the top-level `warming` nor the model's `cache.warming` turns it on. */
  Off: {}
  /** `"auto"` timing on a cache that lasts longer than `duration`, so no ping is needed before the window closes. */
  CacheOutlivesWindow: {}
  /** An explicit interval that isn't positive and shorter than a finite `duration`. */
  InvalidInterval: {}
}>
const Decision = Data.taggedEnum<Decision>()

// The interval for "auto" when the model has no cache.ttl, a little under the five minutes most explicit caches last.
const fallbackInterval = Duration.minutes(4)
const fallbackTTL = Duration.minutes(5)

/** Whether a session's warming is sending pings. */
type Status = Data.TaggedEnum<{
  Active: {}
  /** A ping missed the cache, so pinging waits for the session's next non-warming request. */
  StoppedAfterMiss: {}
}>
const Status = Data.taggedEnum<Status>()

/** What a session's warming loop does next. */
type Next = Data.TaggedEnum<{
  /** The next ping isn't due yet. */
  Wait: { readonly until: number }
  /** The warming window has closed. */
  Expired: {}
  /** A ping is due while a model request runs; it waits for the request to finish rather than compete with it. */
  AwaitRequest: { readonly finished: Deferred.Deferred<void> }
  /** That request ran past the cache's lifetime, so a ping would only write a new cache, not keep the old one. */
  Cold: {}
  Ping: {}
}>
const Next = Data.taggedEnum<Next>()

export const Plugin = define({
  id: "opencode.warming",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    // A model's or provider's `cache.warming` overrides the top-level `warming`.
    const decide = Effect.fn("WarmingPlugin.decide")(function* (event: SessionHooks["context"]) {
      // Warming must never fail the request it hooks, so an unreadable catalog falls back to the top-level setting.
      const cache = (yield* resolveModel(ctx, event).pipe(Effect.orElseSucceed(() => undefined)))?.settings?.cache
      const local = cache?.warming === undefined ? undefined : Option.getOrUndefined(decodeWarming(cache.warming))
      if (cache?.warming !== undefined && local === undefined)
        yield* Effect.logWarning("invalid cache.warming setting; using the top-level warming setting", {
          model: event.model,
        })
      const global = Config.latest(yield* config.entries(), "warming")
      if (!(local ?? global)) return Decision.Off()
      // The keep-alive prompt is only set at the top level; a model's setting changes timing.
      const settings = {
        ...defaults,
        ...(typeof global === "object" ? global : {}),
        ...(typeof local === "object" ? local : {}),
      }
      const { duration } = settings
      const ttl = parseTTL(cache?.ttl)
      // "auto" pings at 90% of the cache's lifetime, so it lands before the cache expires.
      const interval =
        settings.interval === "auto" ? (ttl ? Duration.times(ttl, 0.9) : fallbackInterval) : settings.interval
      // A cache that outlives the window, such as "1h" with the 30-minute default, needs no keep-alive.
      if (
        settings.interval === "auto" &&
        Duration.isFinite(duration) &&
        Duration.isGreaterThanOrEqualTo(interval, duration)
      )
        return Decision.CacheOutlivesWindow()
      const valid =
        Duration.isFinite(duration) &&
        Duration.isGreaterThan(interval, Duration.zero) &&
        Duration.isLessThan(interval, duration)
      // Without a cache.ttl, an explicit interval longer than five minutes implies a cache that lasts at least that long.
      if (valid)
        return Decision.Warm({
          settings: { ...settings, interval, ttl: ttl ?? Duration.max(fallbackTTL, interval) },
        })
      yield* Effect.logWarning("warming interval must be positive and shorter than a finite duration", {
        interval,
        duration,
      })
      return Decision.InvalidInterval()
    })

    const scope = yield* Scope.Scope
    const sessions = new Map<Session.ID, { last: number; expires: number; settings: Settings; status: Status }>()
    // Sessions already told their cache outlives the window; the check runs on every request.
    const outlived = new Set<Session.ID>()
    // A ping during a model request would compete with the request it keeps warm, which stalls single-slot local models.
    // A request counts from its context hook, because `session.step.started` waits for the first response chunk.
    // Each running request's entry completes when it ends, which wakes a loop waiting to ping.
    const requesting = new Map<Session.ID, Deferred.Deferred<void>>()
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
          Effect.suspend(() => {
            // The interval still counts from when the request was sent, because that is when it touched the cache.
            const finished = requesting.get(event.data.sessionID)
            requesting.delete(event.data.sessionID)
            return finished ? Deferred.succeed(finished, undefined) : Effect.void
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    // `last` is when the latest request or ping was sent, since a provider's cache lifetime starts when a request reads or
    // writes it, not when its response ends.
    // `overran` marks a loop resumed by a request that was still running when the ping came due.
    const next = (
      current: { last: number; expires: number; settings: Settings },
      now: number,
      sessionID: Session.ID,
      overran: boolean,
    ) => {
      if (now >= current.expires) return Next.Expired()
      const due = Math.min(current.last + Duration.toMillis(current.settings.interval), current.expires)
      if (now < due) return Next.Wait({ until: due })
      const finished = requesting.get(sessionID)
      if (finished) return Next.AwaitRequest({ finished })
      if (overran && now >= current.last + Duration.toMillis(current.settings.ttl)) return Next.Cold()
      return Next.Ping()
    }
    const loop: (sessionID: Session.ID, overran?: boolean) => Effect.Effect<void> = Effect.fn("WarmingPlugin.loop")(
      function* (sessionID, overran = false) {
        const current = sessions.get(sessionID)
        if (!current) return
        const now = yield* Clock.currentTimeMillis
        const stop = Effect.sync(() => {
          if (sessions.get(sessionID) === current) sessions.delete(sessionID)
        })
        yield* Next.$match(next(current, now, sessionID, overran), {
          Wait: (next) => Effect.sleep(Duration.millis(next.until - now)).pipe(Effect.andThen(loop(sessionID))),
          Expired: () => stop,
          // Pinging as soon as the request ends keeps a cache that is about to expire, and the next interval counts from then.
          AwaitRequest: (next) => Deferred.await(next.finished).pipe(Effect.andThen(loop(sessionID, true))),
          // The next real request starts warming again.
          Cold: () => stop,
          Ping: () =>
            Effect.gen(function* () {
              // A ping touches the cache like any request, so the next interval counts from when it was sent.
              current.last = now
              yield* Effect.logInfo("warming session", { sessionID })
              const result = yield* ctx.session
                .generate({ sessionID, prompt: current.settings.prompt })
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("failed to warm session", { sessionID, cause }).pipe(Effect.as(undefined)),
                  ),
                )
              // A session restarted during the ping has its own loop.
              if (sessions.get(sessionID) !== current) return
              // A real request sent during the ping restarted the interval, and the cache is judged by that request.
              if (current.last !== now) return yield* loop(sessionID)
              // A ping that wrote more to the cache than it read rebuilt the cache instead of keeping it, so later pings
              // would keep paying for that. Providers that report no cache usage never count as a miss.
              if (result && result.tokens.cache.read < result.tokens.cache.write) {
                current.status = Status.StoppedAfterMiss()
                yield* Effect.logInfo("stopped warming session after a cache miss", {
                  sessionID,
                  read: result.tokens.cache.read,
                  write: result.tokens.cache.write,
                })
                return
              }
              return yield* loop(sessionID)
            }),
        })
      },
    )

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)
        if (session.parentID) return

        const active = sessions.get(event.sessionID)
        const stop = Effect.sync(() => {
          sessions.delete(event.sessionID)
          return undefined
        })
        const settings = yield* Decision.$match(yield* decide(event), {
          Warm: (decision) =>
            Effect.sync(() => {
              outlived.delete(event.sessionID)
              return decision.settings
            }),
          Off: () => stop,
          InvalidInterval: () => stop,
          CacheOutlivesWindow: () =>
            Effect.gen(function* () {
              if (!outlived.has(event.sessionID)) {
                outlived.add(event.sessionID)
                yield* Effect.logInfo("not warming: the prompt cache outlives the warming window", {
                  sessionID: event.sessionID,
                  model: event.model,
                })
              }
              return yield* stop
            }),
        })
        if (!settings) return

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
        if (active && Status.$is("Active")(active.status)) {
          active.last = now
          active.expires = now + duration
          active.settings = settings
          return
        }
        // A session stopped after a miss has no running loop, so its next real request starts one.
        sessions.set(event.sessionID, { last: now, expires: now + duration, settings, status: Status.Active() })
        yield* Effect.logInfo(active ? "resumed session warming" : "scheduled session warming", {
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
      Effect.gen(function* () {
        // Steps of one turn share an entry, so the next end event wakes a waiting loop even if a step ended silently.
        if (!requesting.has(event.sessionID)) requesting.set(event.sessionID, yield* Deferred.make<void>())
        yield* hook(event)
      }),
    )
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})

const units = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

function parseTTL(ttl: Provider.CacheTTL | undefined) {
  const match = ttl?.match(/^([\d.]+)(ms|s|m|h|d)$/)
  if (match) return Duration.millis(Number(match[1]) * units[match[2] as keyof typeof units])
}
