import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventExact } from "@opencode-ai/core/event-exact"
import { Cause, Effect, Exit, Layer } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionMutation } from "@/session/closure/mutation"
import { SessionReplayPermit } from "@/session/closure/replay-permit"
import type { SessionID } from "@/session/schema"
import { unusedJobs } from "../lib/closure"
import { itBounded as it } from "../lib/effect"

// CP-023 §7.7, the EventV2 Session replay/projectors row, and Gate 3 step 4.
//
// WHY THE ASSERTIONS LOOK AT CORE REPLAY RATHER THAN AT DATABASE ROWS.
//
// The requirement is not merely "a fenced replay fails" — it is that "a fence refusal occurs before
// projector SQL". That ordering is the whole point: `commitDurableEvent` runs every registered
// projector inside ONE uninterruptible immediate transaction (event.ts:237, projectors at :320-322)
// and before the event-store write, so by the time any projector has run, `db.delete(MessageTable)`
// / `db.delete(PartTable)` / `db.delete(SessionTable)` have already committed together. There is no
// "partway" state to observe and nothing to roll back from inside.
//
// The projectors are reachable ONLY through core `EventV2.replay`. So proving that core replay is
// never entered proves the refusal beat the SQL, exactly and at its own boundary. Asserting on
// surviving rows instead would prove the same thing more weakly and would require hand-maintaining
// durable sequence numbers (`replay` dies unless seq === latest + 1, event.ts:295-302), which would
// make the fixture, not the guard, the thing most likely to fail.
//
// Every negative below is paired with a positive control of identical shape, because "core replay
// was not called" is also what a broken fixture that never calls anything would report.

type Recorder = { readonly calls: string[][] }

const recorder = (): Recorder => ({ calls: [] })

/** A core EventV2 whose `replay`/`replayAll` record the aggregates they were asked to project. */
const spyEvents = (into: Recorder) =>
  Layer.mergeAll(
    Layer.succeed(
      EventV2.Service,
      EventV2.Service.of({
        publish: () => Effect.die("unused"),
        subscribe: () => Effect.die("unused") as never,
        all: () => Effect.die("unused") as never,
        durable: () => Effect.die("unused") as never,
        // The bridge subscribes at construction; hand back a no-op unsubscribe.
        listen: () => Effect.succeed(Effect.void),
        project: () => Effect.void,
        replay: (event: EventV2.SerializedEvent) => Effect.sync(() => void into.calls.push([event.aggregateID])),
        replayAll: (events: EventV2.SerializedEvent[]) =>
          Effect.sync(() => {
            into.calls.push(events.map((item) => item.aggregateID))
            return events[0]?.aggregateID
          }),
        remove: () => Effect.void,
        claim: () => Effect.void,
      }),
    ),
    Layer.succeed(
      EventExact.Service,
      EventExact.Service.of({ issue: () => Effect.die("unused"), publish: () => Effect.die("unused") }),
    ),
  )

const mutationClosure = (admit: boolean, reserved: { sessions: readonly SessionID[]; kind: string }[]) =>
  SessionClosure.Service.of({
    ...unusedJobs,
    request: () => Effect.die("unused"),
    view: Effect.die("unused"),
    identity: Effect.die("unused"),
    acquire: () => Effect.die("unused"),
    bind: () => Effect.void,
    retire: () => Effect.void,
    reserveMutation: (input) =>
      Effect.sync(() => {
        reserved.push({ sessions: input.sessions, kind: input.kind })
        if (!admit) return { type: "refused" as const, reason: "fenced" as const }
        return { type: "reserved" as const, mutation: Model.id("mutation", `mutation_${reserved.length}`) }
      }),
    activateMutation: () => Effect.void,
    retireMutation: () => Effect.void,
  })

const serialized = (aggregate: string, seq: number): EventV2.SerializedEvent => ({
  id: EventV2.ID.make(`evt_${aggregate}_${seq}`),
  aggregateID: aggregate,
  seq,
  type: "session.message.removed",
  data: {},
})

const withBridge = <A, E>(into: Recorder, body: Effect.Effect<A, E, EventV2Bridge.Service>) =>
  body.pipe(Effect.provide(LayerNode.compile(EventV2Bridge.node, [[EventV2.node, spyEvents(into)]])))

describe("EventV2Bridge replay permit (CP-023 §7.7)", () => {
  it.live("refuses to reach core replay without a permit, and admits it with one", () =>
    Effect.gen(function* () {
      const into = recorder()

      const blocked = yield* withBridge(
        into,
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          return yield* events.replay(serialized("ses_alpha", 1)).pipe(Effect.exit)
        }),
      )

      // §7.7: "direct unguarded core Session replay is forbidden." It is a DEFECT rather than a
      // typed failure because `EventV2.Interface.replay` declares no error channel — see the
      // rationale on `SessionReplayPermit.require_`.
      expect(Exit.isFailure(blocked)).toBe(true)
      if (!Exit.isFailure(blocked)) return
      const reason = Cause.prettyErrors(blocked.cause)
        .map((error) => error.message)
        .join("\n")
      expect(reason).toContain("unguarded EventV2 Session replay")
      // The load-bearing half: core replay was never entered, so no projector ran.
      expect(into.calls).toEqual([])

      // Positive control of identical shape. Without it, "no calls" could just mean the bridge is
      // broken or the spy is never wired.
      yield* withBridge(
        into,
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          yield* events.replay(serialized("ses_alpha", 1))
        }).pipe(
          Effect.provideService(SessionReplayPermit.Service, { aggregates: new Set(["ses_alpha"]) }),
        ),
      )
      expect(into.calls).toEqual([["ses_alpha"]])
    }),
  )

  it.live("requires the permit to cover EVERY aggregate in a batch", () =>
    Effect.gen(function* () {
      const into = recorder()
      const batch = [serialized("ses_alpha", 1), serialized("ses_beta", 1)]

      const partial = yield* withBridge(
        into,
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          return yield* events.replayAll(batch).pipe(Effect.exit)
        }).pipe(
          // Covers only one of the two aggregates the batch touches.
          Effect.provideService(SessionReplayPermit.Service, { aggregates: new Set(["ses_alpha"]) }),
        ),
      )

      // Partial coverage must fail closed. A permit taken for one session must not license
      // projection into another, or the lease's scope would be silently widened past the sessions
      // whose fences were actually checked.
      expect(Exit.isFailure(partial)).toBe(true)
      expect(into.calls).toEqual([])

      yield* withBridge(
        into,
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          yield* events.replayAll(batch)
        }).pipe(
          Effect.provideService(SessionReplayPermit.Service, {
            aggregates: new Set(["ses_alpha", "ses_beta"]),
          }),
        ),
      )
      expect(into.calls).toEqual([["ses_alpha", "ses_beta"]])
    }),
  )
})

describe("SessionMutation.replayLeased (CP-023 §7.7, I-22)", () => {
  it.live("refuses a fenced replay before core replay is entered", () =>
    Effect.gen(function* () {
      const into = recorder()
      const reserved: { sessions: readonly SessionID[]; kind: string }[] = []
      const closure = mutationClosure(false, reserved)

      const refused = yield* withBridge(
        into,
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          return yield* SessionMutation.replayLeased(
            closure,
            ["ses_alpha"],
            events.replayAll([serialized("ses_alpha", 1)]),
          ).pipe(Effect.flip)
        }),
      )

      expect(refused._tag).toBe("SessionClosureMutationRefused")
      expect(refused.kind).toBe("replay")
      // Positive precondition: admission WAS consulted, for this exact scope.
      expect(reserved).toHaveLength(1)
      expect(reserved[0]!.sessions.map(String)).toEqual(["ses_alpha"])
      // The ordering claim §7.7 actually makes: the refusal beat core replay, so no projector ran
      // and no `db.delete(...)` committed.
      expect(into.calls).toEqual([])
    }),
  )

  it.live("control: an admitted replay reaches core replay exactly once", () =>
    Effect.gen(function* () {
      const into = recorder()
      const reserved: { sessions: readonly SessionID[]; kind: string }[] = []
      const closure = mutationClosure(true, reserved)

      yield* withBridge(
        into,
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          yield* SessionMutation.replayLeased(
            closure,
            ["ses_alpha"],
            events.replayAll([serialized("ses_alpha", 1)]),
          )
        }),
      )

      // Establishes that the refusal above was a refusal, not a fixture that never replays.
      // It also proves `replayLeased` issues the permit the bridge demands: without it this call
      // would die exactly as the first test's unguarded call did.
      expect(reserved).toHaveLength(1)
      expect(into.calls).toEqual([["ses_alpha"]])
    }),
  )

  it.live("takes ONE lease scoped to every distinct aggregate, never one per event", () =>
    Effect.gen(function* () {
      const into = recorder()
      const reserved: { sessions: readonly SessionID[]; kind: string }[] = []
      const closure = mutationClosure(true, reserved)
      const batch = [serialized("ses_alpha", 1), serialized("ses_alpha", 2), serialized("ses_beta", 1)]

      yield* withBridge(
        into,
        Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          yield* SessionMutation.replayLeased(
            closure,
            batch.map((event) => event.aggregateID),
            events.replayAll(batch),
          )
        }),
      )

      // One reservation for the batch — per-event leasing would give three. A fence landing between
      // events k and k+1 would otherwise refuse the tail after the head had already committed its
      // projector deletes, leaving the projection inconsistent with the event store: I-22's window.
      expect(reserved).toHaveLength(1)
      expect(reserved[0]!.kind).toBe("replay")
      // Deduplicated, and covering both aggregates the batch touches.
      expect([...reserved[0]!.sessions].map(String).sort()).toEqual(["ses_alpha", "ses_beta"])
      expect(into.calls).toEqual([["ses_alpha", "ses_alpha", "ses_beta"]])
    }),
  )
})
