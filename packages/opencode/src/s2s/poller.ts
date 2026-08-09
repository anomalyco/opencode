// Session-to-Session — Task 5 (per-process poller + 60s reaper + V1 idle-wake).
//
// This service is the bridge between the cross-process s2s_inbox table
// (a foreign opencode process writes a row when a session there wants to
// deliver a message to a session in THIS process) and the in-process
// Messaging inbox that the runLoop's drain block already knows how to
// consume. Two responsibilities, both idempotent and rate-bounded:
//
//   1. pollOnce (called on a ~2s interval when the experimentalS2S flag
//      is on):
//        a) claim every undrained s2s_inbox row whose target is in this
//           process's local set (claimForSessions is a single SQL
//           UPDATE…RETURNING so the claim is atomic across processes);
//        b) for each claimed row, decode the v1 capsule and enqueue the
//           body into Messaging.inbox tagged with source="sibling-session"
//           (the drain's Task-6 branch reads this tag to choose the
//           <external-context> framing instead of the in-process marker);
//        c) if the target session is IDLE and has a committed lastUser
//           (so the runLoop will not throw at prompt.ts:1157), wake it by
//           calling SessionPrompt.loop. The wake MUST live here, not on
//           Messaging — adding it to Messaging would create the cycle
//           (Messaging → SessionPrompt → ToolRegistry → Messaging) that
//           breaks the ToolRegistry layer build.
//
//   2. reapOnce (called on a 60s interval): reset drained_at to NULL on
//      any claimed row whose claim is older than REAPER_WINDOW_MS. A
//      redelivery after a reaper is a duplicate, but the dedup-on-id in
//      Task 7 makes a redundant redelivery harmless; the simpler
//      time-based reap is preferred over a per-target liveness gate so
//      this service stays small. A future refinement can add a
//      status.get(busy|retry) skip for targets currently running.
//
// The poller layer also forks the two loops into the layer's scope,
// gated on RuntimeFlags.experimentalS2S. The fork is suppressed in tests
// by passing experimentalS2S: false to the test's RuntimeFlags layer, so
// the test can drive pollOnce / reapOnce directly without a racing
// background loop.

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import * as Scope from "effect/Scope"
import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Stream } from "effect"
import { Messaging } from "@/messaging"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { S2SStore } from "@/s2s/store"
import { decodeCapsuleOption } from "@/s2s/capsule"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionV1 } from "@opencode-ai/core/v1/session"

import { registerWakeBody } from "@/s2s/wake-registry"

const REAPER_WINDOW_MS_DEFAULT = 60_000
const MIN_REAPER_MS = 1
const MAX_ROW_FAILURES = 3
const rowFailures = new Map<string, number>()
const abandonedRows = new Set<string>()

export interface Interface {
  readonly pollOnce: () => Effect.Effect<void>
  readonly reapOnce: (now: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/S2SPoller") {}

// `claimForServices` returns rows in the order the SQL engine picks; we
// don't care about that here, only that each row is processed once.
const processRow = Effect.fn("S2SPoller.processRow")(function* (row: S2SStore.InboxRow) {
  if (abandonedRows.has(row.id)) return
  const messaging = yield* Messaging.Service
  const store = yield* S2SStore.Service

  const cap = decodeCapsuleOption(row.capsule)
  if (Option.isNone(cap)) {
    // poller-safe: never throw on a malformed row. A bad row is left
    // claimed (drained_at set by the SQL above) so we don't loop on it;
    // a manual intervention can re-insert or delete the row.
    yield* Effect.logWarning("S2SPoller: malformed capsule row skipped", {
      rowID: row.id,
      target: row.targetSessionID,
    })
    return
  }

  // Use the row's from_session_id when present, else fall back to the
  // target itself (the row's from_session_id column is nullable in the
  // schema — it can be NULL when the sender is a synthetic system
  // message, e.g. a coordinator timeout ping). from_slug defaults to
  // "unknown" so the drain marker never carries an empty sender.
  const fromSession: SessionID = row.fromSessionID ?? row.targetSessionID
  const fromSlug = row.fromSlug ?? "unknown"
  // Human-readable sender name from the capsule (snapshot at send time); falls
  // back to the slug for capsules minted before sender_name existed.
  const fromName = cap.value.sender_name ?? fromSlug

  // Push into the in-process inbox tagged as cross-session. enqueue may
  // fail with NotFoundError if the target slug was never registered; the
  // target's sessionID IS the right key (not the slug) here, so we
  // proceed and let enqueue's slug-lookup guard reject silently. The
  // row is already claimed either way, so a future poll will not retry
  // it; the worst case is a foreign message silently dropped on the
  // floor, which is the right behavior for an unregistered target.
  yield* messaging.enqueue({
    target: row.targetSessionID,
    from: fromSession,
    fromSlug,
    fromName,
    body: cap.value.body,
    source: "sibling-session",
  })

  // Delivered into the in-process inbox — hard-delete the durable row so the
  // 60s reaper only ever redelivers CRASHED claims (delivering fiber died
  // before this line), never a row that already reached the recipient.
  // enqueue-then-delete = at-least-once: a failed enqueue throws before this
  // and leaves the row claimed for reaper retry, so no message is lost.
  yield* store.deleteInbox(row.id)

  yield* wakeIfIdle(row.targetSessionID)
})

const wakeIfIdle = Effect.fn("S2SPoller.wakeIfIdle")(function* (target: SessionID) {
  const status = yield* SessionStatus.Service
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service

  // A busy / retry session will drain the inbox at its own next turn
  // boundary (the drain block sits at the top of the runLoop iteration);
  // there is nothing for us to do. A session in "idle" is either not
  // running or is between iterations and waiting.
  const st = yield* status.get(target)
  if (st.type !== "idle") return

  // A zero-message session would throw at prompt.ts:1157 on the very
  // first runLoop iteration ("No user message found in stream"). Skip
  // the wake in that case; the user-driven path that creates the first
  // user message will loop and pick up the inbox naturally.
  const last = yield* sessions.findMessage(target, (m) => m.info.role === "user")
  if (Option.isNone(last)) return

  // Hand-off to the existing V1 wake mechanism. The drain block inside
  // the runLoop (prompt.ts:1216-1262, gated on
  // flags.experimentalAgentMessaging) consumes the item at the turn
  // boundary and injects a user message; we DO NOT inject any transcript
  // part here — that would race with the drain.
  yield* prompt.loop({ sessionID: target })
})

// Task 9b — exported for C′ reuse.
export const pollOnceImpl = Effect.fn("S2SPoller.pollOnce")(function* () {
  const store = yield* S2SStore.Service
  const messaging = yield* Messaging.Service

  const locals = yield* messaging.localSet()
  if (locals.length === 0) return

  const rows = yield* store.claimForSessions(locals)
  for (const row of rows) {
    // processRow is per-row; an exception in one row's wake must not
    // prevent subsequent rows from being processed. Failures are caught
    // and logged so the loop always continues to the next row.
    yield* processRow(row).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          const failures = (rowFailures.get(row.id) ?? 0) + 1
          rowFailures.set(row.id, failures)
          if (failures < MAX_ROW_FAILURES) return
          abandonedRows.add(row.id)
          yield* Effect.logWarning("S2SPoller: giving up on row for this process lifetime", {
            rowID: row.id,
            failures,
            error: e,
          })
        }),
      ),
    )
  }
})

// Convenience for the C′ wake-poller fork: the full poll loop body with
// requirements erased (same pattern as the Interface wrapper at :183).
// At runtime the caller's fiber has all required services in context.
export const wakePollerLoop = (pollMs: number): Effect.Effect<void> =>
  pollOnceImpl().pipe(
    // A single tick failure must NOT silently terminate Effect.schedule (which
    // would permanently disable cross-process delivery for this instance). Log
    // at warning level and let the schedule continue to the next tick.
    Effect.catchCause((cause) =>
      Effect.logWarning("s2s wake-poller tick failed", { cause: Cause.pretty(cause) }),
    ),
    Effect.schedule(Schedule.spaced(Duration.millis(pollMs))),
  ) as unknown as Effect.Effect<void>

// Register into the wake-registry so SessionPrompt.loop can fork the
// C′ poller without importing from poller.ts (which imports SessionPrompt
// → would create a module-level cycle).
registerWakeBody(wakePollerLoop)

const reapOnceImpl = Effect.fn("S2SPoller.reapOnce")(function* (now: number, windowMs = REAPER_WINDOW_MS_DEFAULT) {
  const store = yield* S2SStore.Service
  // Time-based reap. The REAPER_WINDOW_MS guard (60s) matches the
  // expected runLoop turn budget with generous slack, so any claim
  // older than that almost certainly represents a crashed wake. A
  // per-target status gate (skip reaping rows whose target is busy) is
  // documented in the task as a refinement; the dedup-on-id in Task 7
  // makes a redundant redelivery harmless, so the simpler time-based
  // version is the chosen shape.
  yield* store.reapStale(now - windowMs)

  // Garbage-collect rows that reference sessions that no longer exist.
  // Best-effort: a GC failure is logged but must not break the reaper
  // tick (the same pattern as the pollOnce error handler).
  yield* store.deleteOrphaned().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("S2SPoller: deleteOrphaned failed", { cause: Cause.pretty(cause) }),
    ),
  )
})

const parseMs = (raw: string | undefined, fallback: number, min: number): number => {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, n)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    const scope = yield* Scope.Scope

    // The interface signatures use the bare `Effect.Effect<void>` shape
    // (which TS widens to `Effect<void, never, never>`); the underlying
    // `pollOnceImpl` / `reapOnceImpl` carry their real error and
    // requirement types. Wrap with a thin lambda so the Interface's
    // `Effect<void, never, never>` contract is preserved.
    const pollOnce: Interface["pollOnce"] = () => pollOnceImpl() as unknown as Effect.Effect<void>
    const reapOnce: Interface["reapOnce"] = (now) =>
      reapOnceImpl(now) as unknown as Effect.Effect<void>

    // Background loops — gated on the experimentalS2S flag so the
    // service is dead code in environments where S2S is off (the test
    // harness sets experimentalS2S: false to avoid a racing loop).
    //
    // Only the reaper is forked at layer-build. Cross-process delivery
    // + idle-session wake now run in-context: D drains s2s_inbox at
    // the runLoop turn boundary, and C′ forks a per-instance wake
    // poller from SessionPrompt.loop (prompt.ts ~:1591-1602) which
    // captures the live fiber's InstanceRef. The old layer-build poll
    // loop + Created subscriber were removed — session registration
    // (registerLocal + registerSlug) now happens in SessionPrompt.loop.
    if (flags.experimentalS2S) {
      const reapWindowMs = parseMs(
        process.env["OPENCODE_S2S_REAP_WINDOW_MS"],
        REAPER_WINDOW_MS_DEFAULT,
        MIN_REAPER_MS,
      )
      // Reap interval matches the window by default so each tick resets any
      // claim older than one window. Overriding the window also shrinks the
      // interval, which lets tests drive the loop quickly without real sleeps.
      const reapSchedule = Schedule.spaced(Duration.millis(reapWindowMs))

      // Only the reaper is forked at layer-build (Database-only, no InstanceRef
      // needed). Cross-process delivery + idle-session wake now run in-context:
      // D drains s2s_inbox at the runLoop turn boundary, and C′ forks a
      // per-instance wake poller from SessionPrompt.loop via `attach` (which
      // captures the live fiber's InstanceRef). The old layer-build poll loop +
      // Created subscriber were removed — they forked here with no InstanceRef
      // and died on first tick.
      yield* Effect.suspend(() => reapOnceImpl(Date.now(), reapWindowMs)).pipe(
        Effect.schedule(reapSchedule),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    }

    return Service.of({ pollOnce, reapOnce })
  }),
)

// The poller depends on the services the AppLayer already provides
// (RuntimeFlags, S2SStore, Messaging, Session, SessionStatus, SessionPrompt,
// EventV2Bridge). `Scope` is a built-in primitive so it is consumed by the
// layer effect itself and not listed here. The `node` form is exported so
// the AppLayer wiring step can splice it into the graph without re-deriving
// the dep list.
export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    RuntimeFlags.node,
    S2SStore.node,
    Messaging.node,
    Session.node,
    SessionStatus.node,
    SessionPrompt.node,
    EventV2Bridge.node,
  ],
})

export * as S2SPoller from "./poller"
