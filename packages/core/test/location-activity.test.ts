import { describe, expect } from "bun:test"
import { Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, RcMap, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Location } from "@opencode/core/location"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationServiceMap, type LocationServices } from "@opencode/core/location-services"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Workspace } from "@opencode/core/workspace"
import { testEffect } from "./lib/effect"

const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/project") })

// The fixture runner waits on human input instead of making a model request, so a
// pending question or permission produces no durable activity while it is outstanding.
// A "hung" session never waits on a human and stands in for stalled model work.
function waiting(sessionID: Session.ID, forms: Form.Interface, permissions: Permission.Interface) {
  if (sessionID.includes("hung")) return Effect.never
  if (sessionID.includes("permission"))
    return permissions
      .assert({ id: Permission.ID.create(), sessionID, action: "edit", resources: ["src/index.ts"] })
      .pipe(Effect.orDie)
  return forms.ask({ sessionID, title: "Questions", fields: [{ key: "runtime", type: "string" }] }).pipe(Effect.orDie)
}

// Keep real execution ownership, location caching, forms, and eviction. Permission
// ownership is per location like forms, but the real service also needs agents, saved
// rules, and plugin hooks, so this fixture keeps only its pending-request behavior.
const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const map = yield* LayerMap.make(
      (ref: Location.Ref) => {
        const pending = new Map<Permission.ID, { request: Permission.Request; deferred: Deferred.Deferred<void> }>()
        // The fixture only exercises these four Location services.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        return Layer.merge(
          Layer.succeed(
            Location.Service,
            Location.Service.of({
              directory: ref.directory,
              workspaceID: ref.workspaceID,
              project: { id: Project.ID.global, directory: ref.directory, canonical: ref.directory },
            }),
          ),
          Layer.effect(
            SessionRunner.Service,
            Effect.gen(function* () {
              const forms = yield* Form.Service
              const permissions = yield* Permission.Service
              return SessionRunner.Service.of({
                drain: ({ sessionID }) =>
                  waiting(sessionID, forms, permissions).pipe(
                    Effect.as(SessionRunner.DrainResult.Complete()),
                    Effect.onInterrupt(() => Effect.sleep("5 minutes")),
                  ),
              })
            }),
          ),
        ).pipe(
          Layer.provideMerge(
            Layer.merge(
              Form.layer,
              Layer.mock(Permission.Service, {
                close: Effect.void,
                assert: (input) =>
                  Effect.gen(function* () {
                    const request = Permission.Request.make({
                      id: input.id ?? Permission.ID.create(),
                      sessionID: input.sessionID,
                      action: input.action,
                      resources: input.resources,
                    })
                    const deferred = yield* Deferred.make<void>()
                    pending.set(request.id, { request, deferred })
                    yield* bus.publish(Permission.Event.Asked, request)
                    yield* Deferred.await(deferred).pipe(
                      Effect.onInterrupt(() => Effect.sync(() => pending.delete(request.id))),
                    )
                  }),
                reply: (input) =>
                  Effect.suspend(() => {
                    const item = pending.get(input.requestID)
                    if (!item) return Effect.void
                    pending.delete(input.requestID)
                    return Deferred.succeed(item.deferred, undefined).pipe(Effect.asVoid)
                  }),
                list: () => Effect.sync(() => Array.from(pending.values(), (item) => item.request)),
              }),
            ),
          ),
          Layer.provide(Layer.succeed(Bus.Service, bus)),
          Layer.fresh,
        ) as unknown as Layer.Layer<LocationServices>
      },
      { idleTimeToLive: Duration.infinity },
    )
    return {
      ...map,
      get: (ref: Location.Ref) => map.get(LocationServiceMap.canonical(ref)),
      contextEffect: (ref: Location.Ref) => map.contextEffect(LocationServiceMap.canonical(ref)),
      contextEffectOption: (ref: Location.Ref) => map.contextEffectOption(LocationServiceMap.canonical(ref)),
      invalidate: (ref: Location.Ref) => map.invalidate(LocationServiceMap.canonical(ref)),
    }
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      LocationServiceMap.node,
      SessionExecution.node,
      LocationActivity.node,
    ]),
    [
      LocationServiceMap.node.replace(
        makeGlobalNode({
          service: LocationServiceMap.Service,
          layer: locations,
          deps: [Bus.node],
        }),
      ),
    ],
  ),
)

// `later` sessions are seeded but not started, so a test can admit one mid-cleanup.
function harness(sessionIDs: ReadonlyArray<Session.ID>, later: ReadonlyArray<Session.ID> = []) {
  return Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    const execution = yield* SessionExecution.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: ref.directory, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values(
        [...sessionIDs, ...later].map((sessionID) => ({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "question",
          directory: ref.directory,
          title: "Waiting question",
          version: "test",
        })),
      )
      .run()
      .pipe(Effect.orDie)

    const forms: Form.Info[] = []
    const requests: Permission.Request[] = []
    const interrupted: SessionEvent.Execution.Interrupted["data"][] = []
    const waited = yield* Deferred.make<void>()
    const unsubscribe = yield* bus.listen((event) =>
      Effect.gen(function* () {
        if (event.type === SessionEvent.Execution.Interrupted.type) {
          interrupted.push(Schema.decodeUnknownSync(SessionEvent.Execution.Interrupted.data)(event.data))
        }
        if (event.type === Form.Event.Created.type) {
          forms.push(Schema.decodeUnknownSync(Form.Event.Created.data)(event.data).form)
          yield* Deferred.succeed(waited, undefined).pipe(Effect.asVoid)
        }
        if (event.type === Permission.Event.Asked.type) {
          requests.push(Schema.decodeUnknownSync(Permission.Request)(event.data))
          yield* Deferred.succeed(waited, undefined).pipe(Effect.asVoid)
        }
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    // Release anything still parked on human input, then let slow cleanup settle.
    yield* Effect.addFinalizer(() =>
      Effect.forEach([...sessionIDs, ...later], (sessionID) => execution.interrupt(sessionID)).pipe(
        Effect.andThen(TestClock.adjust("5 minutes")),
      ),
    )
    const running = yield* Effect.forEach(sessionIDs, (sessionID) =>
      execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped),
    )
    return { forms, requests, interrupted, waited, running }
  })
}

const reaped = (events: ReadonlyArray<SessionEvent.Execution.Interrupted["data"]>) =>
  events.filter((event) => event.reason === "inactivity").map((event) => event.sessionID)

describe("LocationActivity human waits", () => {
  it.effect("keeps the location cached while a question stays pending", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_waiting_form")
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const store = yield* SessionStore.Service
      const watch = yield* harness([sessionID])
      yield* Deferred.await(watch.waited)
      const forms = Context.get(yield* map.contextEffect(ref).pipe(Effect.scoped), Form.Service)
      expect(yield* store.listSuspended()).toEqual([sessionID])

      // Human input produces no durable activity, so twelve hours of sweeps pass
      // with nothing to refresh the location's deadline.
      yield* Effect.forEach(Array.from({ length: 24 }), () => TestClock.adjust("30 minutes"), { discard: true })
      expect(reaped(watch.interrupted)).toEqual([])
      expect(Array.from(yield* execution.active)).toEqual([sessionID])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect((yield* forms.list()).map((form) => form.id)).toEqual([watch.forms[0].id])
      expect(yield* forms.state(watch.forms[0].id)).toEqual({ status: "pending" })

      // The original question still accepts its answer and the execution resumes.
      yield* forms.reply({ id: watch.forms[0].id, answer: { runtime: "bun" } })
      expect((yield* Fiber.join(watch.running[0]))._tag).toEqual("Success")
      expect(yield* forms.state(watch.forms[0].id)).toEqual({ status: "answered", answer: { runtime: "bun" } })
      expect(Array.from(yield* execution.active)).toEqual([])

      // Nothing waits on a human now, so the idle location reaches its deadline.
      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      expect(reaped(watch.interrupted)).toEqual([])
    }),
  )

  it.effect("keeps the location cached while a permission request stays pending", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_waiting_permission")
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const watch = yield* harness([sessionID])
      yield* Deferred.await(watch.waited)
      const permissions = Context.get(yield* map.contextEffect(ref).pipe(Effect.scoped), Permission.Service)

      yield* Effect.forEach(Array.from({ length: 24 }), () => TestClock.adjust("30 minutes"), { discard: true })
      expect(reaped(watch.interrupted)).toEqual([])
      expect(Array.from(yield* execution.active)).toEqual([sessionID])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect(yield* permissions.list()).toEqual([watch.requests[0]])

      yield* permissions.reply({ requestID: watch.requests[0].id, reply: "once" })
      expect((yield* Fiber.join(watch.running[0]))._tag).toEqual("Success")
      expect(yield* permissions.list()).toEqual([])
      expect(Array.from(yield* execution.active)).toEqual([])

      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      expect(reaped(watch.interrupted)).toEqual([])
    }),
  )

  it.effect("still stops a pending question when the user interrupts it", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_cancelled_form")
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const store = yield* SessionStore.Service
      const watch = yield* harness([sessionID])
      yield* Deferred.await(watch.waited)
      const forms = Context.get(yield* map.contextEffect(ref).pipe(Effect.scoped), Form.Service)
      yield* TestClock.adjust("3 hours")

      yield* execution.interrupt(sessionID)
      yield* TestClock.adjust("5 minutes")
      expect((yield* Fiber.join(watch.running[0]))._tag).toEqual("Failure")
      expect(yield* forms.state(watch.forms[0].id)).toEqual({ status: "cancelled" })
      expect(Array.from(yield* execution.active)).toEqual([])
      expect(yield* store.listSuspended()).toEqual([])
      expect(reaped(watch.interrupted)).toEqual([])

      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  for (const count of [1, 2, 3] as const) {
    it.effect(`still reaps ${count} executions that are not waiting on a human`, () =>
      Effect.gen(function* () {
        const sessionIDs = Array.from({ length: count }, (_, index) => Session.ID.make(`ses_hung_execution_${index}`))
        const map = yield* LocationServiceMap.Service
        const execution = yield* SessionExecution.Service
        const store = yield* SessionStore.Service
        const idle = Location.Ref.make({ directory: ref.directory, workspaceID: Workspace.ID.make("wrk_idle") })
        const watch = yield* harness(sessionIDs)
        yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)
        yield* TestClock.adjust("1 minute")
        expect(Array.from(yield* execution.active).toSorted()).toEqual(sessionIDs.toSorted())

        yield* TestClock.adjust("62 minutes")
        // Interruption has stopped every drain, but slow cleanup still owns the graph.
        expect(Array.from(yield* execution.active).toSorted()).toEqual(sessionIDs.toSorted())
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
        yield* TestClock.adjust("5 minutes")
        const results = yield* Effect.forEach(watch.running, Fiber.join)
        expect(results.every((exit) => exit._tag === "Failure")).toBe(true)
        expect(reaped(watch.interrupted).toSorted()).toEqual(sessionIDs.toSorted())
        expect(yield* store.listSuspended()).toEqual([])
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      }),
    )
  }

  it.effect("retains the cached graph for work admitted while a reaped owner cleans up", () =>
    Effect.gen(function* () {
      const reaping = Session.ID.make("ses_hung_reaped")
      const admitted = Session.ID.make("ses_hung_admitted")
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const store = yield* SessionStore.Service
      const watch = yield* harness([reaping], [admitted])
      yield* TestClock.adjust("1 minute")
      const graph = yield* map.contextEffect(ref).pipe(Effect.scoped)
      expect(Array.from(yield* execution.active)).toEqual([reaping])

      yield* TestClock.adjust("62 minutes")
      // Interruption has stopped the drain, but slow cleanup still owns the graph.
      expect(Array.from(yield* execution.active)).toEqual([reaping])
      yield* execution.wake(admitted)
      yield* TestClock.adjust("1 minute")
      expect(Array.from(yield* execution.active).toSorted()).toEqual([admitted, reaping].toSorted())

      yield* TestClock.adjust("4 minutes")
      expect((yield* Fiber.join(watch.running[0]))._tag).toEqual("Failure")
      expect(reaped(watch.interrupted)).toEqual([reaping])
      // The newcomer now owns the graph the reaped session borrowed, so eviction is
      // abandoned and the same services stay cached rather than being rebuilt.
      expect(Array.from(yield* execution.active)).toEqual([admitted])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect(yield* map.contextEffect(ref).pipe(Effect.scoped)).toBe(graph)

      // Abandoning that eviction only renews the deadline; the newcomer waits on no
      // human, so it reaches its own deadline like any other stalled execution.
      yield* TestClock.adjust("62 minutes")
      yield* TestClock.adjust("5 minutes")
      expect(reaped(watch.interrupted).toSorted()).toEqual([admitted, reaping].toSorted())
      expect(yield* store.listSuspended()).toEqual([])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  it.effect("protects a co-owner of a directory where another session waits", () =>
    Effect.gen(function* () {
      const child = Session.ID.make("ses_form_child")
      const parent = Session.ID.make("ses_hung_parent")
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const watch = yield* harness([child, parent])
      yield* Deferred.await(watch.waited)
      const forms = Context.get(yield* map.contextEffect(ref).pipe(Effect.scoped), Form.Service)
      yield* TestClock.adjust("1 minute")
      expect(Array.from(yield* execution.active).toSorted()).toEqual([child, parent].toSorted())

      // The parent publishes no activity of its own, so per-owner filtering would
      // reap it while its child is still blocked on the answer.
      yield* TestClock.adjust("3 hours")
      expect(reaped(watch.interrupted)).toEqual([])
      expect(Array.from(yield* execution.active).toSorted()).toEqual([child, parent].toSorted())
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])

      // Answering lifts the protection; the still-hung parent is reaped as before.
      yield* forms.reply({ id: watch.forms[0].id, answer: { runtime: "bun" } })
      expect((yield* Fiber.join(watch.running[0]))._tag).toEqual("Success")
      yield* TestClock.adjust("62 minutes")
      yield* TestClock.adjust("5 minutes")
      expect(reaped(watch.interrupted)).toEqual([parent])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )
})
