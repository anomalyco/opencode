export * as OpencodeTasks from "./opencode-tasks.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { Duration, Effect, Exit, FiberHandle, Option, Predicate, Random, Schema, Scope, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { LocationPin } from "../../location-pin.js"
import type { OpencodeWatches } from "./opencode-watches.js"

/** Console's config names its own MCP server `opencode_console`; its `claim_task` claims a task for the calling session. */
export const CLAIM_TOOL = "opencode_console_claim_task"
/** Renews every claim one session holds on the member's list: `{ renewed, leaseExpiresAt, leaseMinutes }`. */
export const RENEW_PATH = "/api/task-claims/renew"
/** Releases every claim one session holds on the member's list: `{ released }`. */
export const RELEASE_PATH = "/api/task-claims/release"
/** The shortest lease a member may choose, assumed until Console names theirs (30 minutes unless they changed it). */
export const MIN_LEASE_MINUTES = 5
/** The longest wait between renewals, however long the member's lease. */
export const MAX_INTERVAL = Duration.minutes(10)
const RETRY = Duration.seconds(30)
const TIMEOUT = Duration.seconds(10)
const prefix = "task-claims:"
/** Pins this Location while its sessions hold claims. */
export const PIN_OWNER = "opencode.console-tasks"
const Stored = Schema.Struct({ console: Schema.String })
const decodeStored = Schema.decodeUnknownOption(Stored)
const Renewed = Schema.Struct({ renewed: Schema.Number, leaseMinutes: Schema.Number })

/**
 * The wait before the next renewal: a third of the lease, so a renewal that fails twice still lands inside it, jittered
 * by a tenth so a member's machines don't renew together. Renewing within a third of the lease in force also keeps a
 * claim when the member shortens their lease: the shorter one applies from that renewal on.
 */
export const interval = (leaseMinutes: number) =>
  Random.next.pipe(
    Effect.map((random) =>
      Duration.times(
        Duration.min(Duration.minutes(Math.max(leaseMinutes, MIN_LEASE_MINUTES) / 3), MAX_INTERVAL),
        0.9 + 0.2 * random,
      ),
    ),
  )

/**
 * Keeps the Console task claims of this Location's sessions alive: while a session that claimed a task exists and isn't
 * archived, its claims are renewed in the background, and archiving or deleting it releases them. It never reaches the
 * model. Claims are remembered across restarts, so a session left idle keeps its tasks: while it holds claims its
 * Location stays pinned, so idle eviction doesn't stop the renewals and the server loads it again at boot.
 */
export const make = Effect.fnUntraced(function* (
  ctx: Context,
  http: HttpClient.HttpClient,
  pins: LocationPin.Interface,
) {
  const scope = yield* Scope.Scope
  let current: { console: OpencodeWatches.Console; readonly lease: Scope.Closeable } | undefined
  // The sessions that may hold claims; Console's answer to a renewal says when one no longer does.
  const claimed = new Set<string>()
  let leaseMinutes = MIN_LEASE_MINUTES
  const here = { directory: ctx.location.directory, workspaceID: ctx.location.workspaceID }
  const pinning = Effect.suspend(() => (claimed.size > 0 ? pins.pin(PIN_OWNER, here) : pins.unpin(PIN_OWNER, here)))

  const call = (path: string, sessionID: string) =>
    Effect.gen(function* () {
      if (!current) return yield* Effect.fail(new Error("OpenCode Console is not connected"))
      const request = HttpClientRequest.post(`${current.console.server}${path}`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(yield* current.console.headers),
        HttpClientRequest.bodyJsonUnsafe({ session: sessionID }),
      )
      return yield* HttpClient.withScope(http).execute(request)
    }).pipe(Effect.timeout(TIMEOUT))

  const forget = (sessionID: string) =>
    Effect.gen(function* () {
      claimed.delete(sessionID)
      yield* ctx.storage.remove(prefix + sessionID)
      yield* pinning
    })

  // A 404 is a workspace with Tasks off, and a 403 a sign-in that keeps no list: neither has claims to release.
  const release = (sessionID: string) =>
    call(RELEASE_PATH, sessionID).pipe(
      Effect.flatMap((response) =>
        refused(response) ? Effect.void : HttpClientResponse.filterStatusOk(response).pipe(Effect.asVoid),
      ),
      Effect.scoped,
      Effect.andThen(forget(sessionID)),
    )

  /** Renews one session's claims, or releases them once it is archived or gone. Fails to be retried. */
  const beat = (sessionID: string) =>
    Effect.gen(function* () {
      const session = yield* ctx.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(
        Effect.map(Option.some),
        Effect.catchIf(Predicate.isTagged("Session.NotFoundError"), () => Effect.succeedNone),
      )
      if (Option.isNone(session) || session.value.time.archived !== undefined) return yield* release(sessionID)
      const response = yield* call(RENEW_PATH, sessionID)
      if (refused(response)) return yield* Effect.forEach([...claimed], forget, { discard: true })
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
        Effect.map(Schema.decodeUnknownOption(Renewed)),
      )
      if (Option.isNone(body)) return
      leaseMinutes = body.value.leaseMinutes
      // Released on the page, taken over, closed or taken while stale: nothing is left to renew.
      if (body.value.renewed === 0) yield* forget(sessionID)
    }).pipe(Effect.scoped)

  // Whether every session's claims were renewed or released; any failure is retried sooner.
  const round = Effect.suspend(() =>
    Effect.forEach(
      [...claimed],
      (sessionID) =>
        beat(sessionID).pipe(
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.logDebug("failed to renew Console task claims", { sessionID, cause }).pipe(Effect.as(false)),
          ),
        ),
      { concurrency: 4 },
    ),
  ).pipe(Effect.map((results) => results.every(Boolean)))

  // Started by the first claim and kept, so a claim never races a loop that is ending; with none it only sleeps.
  const loop = Effect.gen(function* () {
    let failures = 0
    while (true) {
      const next = yield* interval(leaseMinutes)
      yield* Effect.sleep(failures === 0 ? next : Duration.min(Duration.times(RETRY, 2 ** (failures - 1)), next))
      failures = (yield* round) ? 0 : failures + 1
    }
  })

  const start = Effect.fnUntraced(function* (key: string) {
    const lease = yield* Scope.Scope
    const beating = yield* FiberHandle.make<void, never>()
    const ensure = FiberHandle.run(beating, loop, { onlyIfMissing: true })

    // Claims remembered from before a restart, for this workspace's sessions in this Location, read before any new
    // claim is, and renewed at once in the background: their lease may be close to its end.
    const stored = yield* ctx.storage.scan({ prefix, limit: 1000 })
    const owned = yield* Effect.forEach(stored.entries, (entry) => {
      const sessionID = entry.key.slice(prefix.length)
      if (Option.getOrUndefined(decodeStored(entry.value))?.console !== key) return Effect.succeed(undefined)
      return ctx.session.get({ sessionID: Session.ID.make(sessionID) }).pipe(
        Effect.map((session) =>
          session.location.directory === ctx.location.directory &&
          session.location.workspaceID === ctx.location.workspaceID
            ? sessionID
            : undefined,
        ),
        // Deleted while OpenCode was down: its claims are released now, by every Location that reads it, which
        // Console takes as one.
        Effect.catchIf(Predicate.isTagged("Session.NotFoundError"), () => Effect.succeed(sessionID)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
    })
    owned.filter((sessionID) => sessionID !== undefined).forEach((sessionID) => claimed.add(sessionID))
    yield* pinning
    if (claimed.size > 0) yield* round.pipe(Effect.andThen(ensure), Effect.forkIn(lease, { startImmediately: true }))

    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed" || event.tool !== CLAIM_TOOL) return Effect.void
      claimed.add(event.sessionID)
      return ctx.storage
        .set(prefix + event.sessionID, { console: key })
        .pipe(Effect.andThen(pinning), Effect.andThen(ensure), Effect.asVoid)
    })
    // Every Location hears every archive and deletion; only the one whose session claimed releases.
    yield* ctx.event.subscribe({ types: ["session.archived", "session.deleted"] }).pipe(
      Stream.runForEach((event) =>
        claimed.has(event.data.sessionID)
          ? release(event.data.sessionID).pipe(
              // Kept, so the next round retries it.
              Effect.catch((cause) =>
                Effect.logDebug("failed to release Console task claims", { sessionID: event.data.sessionID, cause }),
              ),
            )
          : Effect.void,
      ),
      Effect.forkIn(lease, { startImmediately: true }),
    )
  })

  /** Keeps claims alive for `next`, or stops when it is undefined; a new workspace replaces the old one. */
  const sync = Effect.fnUntraced(function* (next: OpencodeWatches.Console | undefined) {
    if (current && next && current.console.key === next.key) {
      current.console = next
      return
    }
    if (current) {
      yield* Scope.close(current.lease, Exit.void)
      current = undefined
      claimed.clear()
      yield* pinning
    }
    if (!next) return
    const lease = yield* Scope.fork(scope)
    current = { console: next, lease }
    yield* start(next.key).pipe(Scope.provide(lease))
  })

  return { sync }
})

/** Tasks are off in the workspace (404), or the sign-in is a service account, which keeps no list (403). */
function refused(response: HttpClientResponse.HttpClientResponse) {
  return response.status === 404 || response.status === 403
}
