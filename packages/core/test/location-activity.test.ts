import { describe, expect } from "bun:test"
import { Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, RcMap, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Permission } from "@opencode/schema/permission"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationServiceMap, type LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Workspace } from "@opencode/core/workspace"
import { testEffect } from "./lib/effect"

// Keep real execution ownership, location caching, forms, and eviction. The fixture
// runner waits on a form instead of making a model request before asking a question.
const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        // The fixture only exercises these three Location services.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.merge(
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
              return SessionRunner.Service.of({
                drain: ({ sessionID }) =>
                  (sessionID.startsWith("ses_active_work") || sessionID === Session.ID.make("ses_permission_work")
                    ? Effect.never
                    : forms.ask({
                        sessionID,
                        title: "Questions",
                        fields: [{ key: "runtime", type: "string" }],
                      })
                  ).pipe(
                    Effect.orDie,
                    Effect.as(SessionRunner.DrainResult.Complete()),
                    Effect.onInterrupt(() => Effect.sleep("5 minutes")),
                  ),
              })
            }),
          ),
        ).pipe(
          Layer.provideMerge(Form.layer),
          Layer.provide(Layer.succeed(Bus.Service, bus)),
          Layer.fresh,
        ) as unknown as Layer.Layer<LocationServices>,
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
      Job.node,
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

const seed = Effect.fn("LocationActivityTest.seed")(function* (
  directory: AbsolutePath,
  rows: readonly { id: Session.ID; parent_id?: Session.ID }[],
) {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
  yield* database.db
    .insert(SessionTable)
    .values(
      rows.map((row) => ({
        project_id: Project.ID.global,
        directory,
        slug: "activity",
        title: "Session",
        version: "test",
        ...row,
      })),
    )
    .run()
})

describe("LocationActivity eviction", () => {
  it.effect("expires a waiting execution without evicting work admitted during its cleanup", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const store = yield* SessionStore.Service
      const sessionID = Session.ID.make("ses_waiting_question")
      const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/project") })
      const idle = Location.Ref.make({ directory: ref.directory, workspaceID: Workspace.ID.make("wrk_idle") })
      yield* seed(ref.directory, [{ id: sessionID }])

      const created = yield* Deferred.make<void>()
      const newCreated = yield* Deferred.make<void>()
      const pending: Form.Info[] = []
      const interrupted: SessionEvent.Execution.Interrupted["data"][] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type === SessionEvent.Execution.Interrupted.type) {
            interrupted.push(Schema.decodeUnknownSync(SessionEvent.Execution.Interrupted.data)(event.data))
          }
          if (event.type !== Form.Event.Created.type) return
          pending.push(Schema.decodeUnknownSync(Form.Event.Created.data)(event.data).form)
          if (pending.length === 1) yield* Deferred.succeed(created, undefined)
          if (pending.length === 2) yield* Deferred.succeed(newCreated, undefined)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Effect.addFinalizer(() =>
        execution.interrupt(sessionID).pipe(Effect.andThen(TestClock.adjust("5 minutes"))),
      )
      yield* Deferred.await(created)
      const context = yield* map.contextEffect(ref).pipe(Effect.scoped)
      const forms = Context.get(context, Form.Service)
      expect(yield* store.listSuspended()).toEqual([sessionID])
      yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)

      // Human input produces no durable activity while the question is pending.
      yield* TestClock.adjust("1 minute")
      yield* TestClock.adjust("62 minutes")
      // Interruption has cancelled the question, but slow cleanup still owns the graph.
      expect(Array.from(yield* execution.active)).toEqual([sessionID])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      for (const form of pending) expect(yield* forms.state(form.id)).toEqual({ status: "cancelled" })

      yield* execution.wake(sessionID)
      yield* TestClock.adjust("5 minutes")
      yield* Deferred.await(newCreated)
      expect((yield* Fiber.join(running))._tag).toBe("Failure")
      expect(Array.from(yield* execution.active)).toEqual([sessionID])
      expect(yield* store.listSuspended()).toEqual([sessionID])
      expect(interrupted).toEqual([{ sessionID, reason: "inactivity" }])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect(yield* forms.list({ sessionID })).toEqual([pending[1]])
      yield* execution.interrupt(sessionID)
      yield* TestClock.adjust("5 minutes")
      yield* execution.awaitIdle(sessionID)
      yield* TestClock.adjust("62 minutes")
      expect(yield* store.listSuspended()).toEqual([])
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  it.effect("expires unanswered requests without interrupting another progressing session in the same location", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const waiting = Session.ID.make("ses_waiting_question")
      const permission = Session.ID.make("ses_permission_work")
      const working = Session.ID.make("ses_active_work")
      const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/project") })
      yield* seed(
        ref.directory,
        [waiting, permission, working].map((id) => ({ id })),
      )
      const created = yield* Deferred.make<Form.Info>()
      const interrupted: SessionEvent.Execution.Interrupted["data"][] = []
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type === Form.Event.Created.type)
          return Deferred.succeed(created, Schema.decodeUnknownSync(Form.Event.Created.data)(event.data).form).pipe(
            Effect.asVoid,
          )
        if (event.type === SessionEvent.Execution.Interrupted.type)
          return Effect.sync(() =>
            interrupted.push(Schema.decodeUnknownSync(SessionEvent.Execution.Interrupted.data)(event.data)),
          )
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* execution.resume(waiting).pipe(Effect.exit, Effect.forkScoped)
      yield* execution.resume(permission).pipe(Effect.exit, Effect.forkScoped)
      yield* execution.resume(working).pipe(Effect.exit, Effect.forkScoped)
      yield* Effect.addFinalizer(() =>
        Effect.forEach([waiting, permission, working], (id) => execution.interrupt(id)).pipe(
          Effect.andThen(TestClock.adjust("5 minutes")),
        ),
      )
      const request = yield* Deferred.await(created)
      const context = yield* map.contextEffect(ref).pipe(Effect.scoped)
      const forms = Context.get(context, Form.Service)
      yield* TestClock.adjust("1 minute")
      yield* bus.publish(Permission.Event.Asked, {
        id: Permission.ID.create("per_waiting"),
        sessionID: permission,
        action: "read",
        resources: ["file"],
      })
      yield* TestClock.adjust("30 minutes")
      yield* bus.publish(SessionEvent.Tool.Progress, {
        sessionID: working,
        assistantMessageID: SessionMessage.ID.make("msg_progress"),
        id: "tool-running",
        metadata: { status: "still working" },
      })
      // Neither another Session's progress nor viewing this question renews its own deadline.
      yield* bus.publish(SessionEvent.Viewed, { sessionID: waiting, idle: 0 }, { location: ref })
      yield* TestClock.adjust("33 minutes")
      yield* TestClock.adjust("5 minutes")
      expect(Array.from(yield* execution.active)).toEqual([working])
      expect(yield* forms.state(request.id)).toEqual({ status: "cancelled" })
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect(interrupted.toSorted((a, b) => a.sessionID.localeCompare(b.sessionID))).toEqual([
        { sessionID: permission, reason: "inactivity" },
        { sessionID: waiting, reason: "inactivity" },
      ])

      yield* execution.interrupt(working)
      yield* TestClock.adjust("5 minutes")
      yield* execution.awaitIdle(working)
      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  it.effect(
    "keeps a waiting parent alive through foreground and background child work, then starts its idle window",
    () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const execution = yield* SessionExecution.Service
        const jobs = yield* Job.Service
        const map = yield* LocationServiceMap.Service
        const parent = Session.ID.make("ses_waiting_parent")
        const child = Session.ID.make("ses_active_work_child")
        const directory = AbsolutePath.make("/project")
        yield* seed(directory, [{ id: parent }, { id: child, parent_id: parent }])
        const created = yield* Deferred.make<Form.Info>()
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Form.Event.Created.type
            ? Deferred.succeed(created, Schema.decodeUnknownSync(Form.Event.Created.data)(event.data).form).pipe(
                Effect.asVoid,
              )
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* execution.resume(parent).pipe(Effect.exit, Effect.forkScoped)
        yield* jobs.start({
          id: child,
          type: "subagent",
          recovery: {
            kind: "subagent",
            parentSessionID: parent,
            childSessionID: child,
            agent: "explore",
            description: "Work",
          },
          run: execution.resume(child).pipe(Effect.as("done")),
        })
        yield* jobs.block({ id: child, sessionID: parent }).pipe(Effect.forkScoped)
        yield* Effect.addFinalizer(() =>
          Effect.forEach([parent, child], (id) => execution.interrupt(id)).pipe(
            Effect.andThen(TestClock.adjust("5 minutes")),
          ),
        )
        const request = yield* Deferred.await(created)
        const context = yield* map.contextEffect(Location.Ref.make({ directory })).pipe(Effect.scoped)
        const forms = Context.get(context, Form.Service)
        yield* TestClock.adjust("30 minutes")
        yield* bus.publish(SessionEvent.Text.Delta, {
          sessionID: child,
          assistantMessageID: SessionMessage.ID.make("msg_child"),
          ordinal: 0,
          delta: "still working",
        })
        yield* TestClock.adjust("38 minutes")
        expect((yield* execution.active).has(parent)).toBe(true)
        expect((yield* execution.active).has(child)).toBe(true)
        yield* jobs.background(child)
        yield* TestClock.adjust("7 minutes")
        expect((yield* execution.active).has(parent)).toBe(true)
        expect((yield* execution.active).has(child)).toBe(true)
        expect(yield* forms.state(request.id)).toEqual({ status: "pending" })
        // The child retains its own stall timeout: it cannot pin the parent forever without progress.
        yield* TestClock.adjust("20 minutes")
        yield* jobs.wait({ id: child })
        expect((yield* execution.active).has(child)).toBe(false)
        expect(yield* forms.state(request.id)).toEqual({ status: "pending" })
        yield* TestClock.adjust("59 minutes")
        expect((yield* execution.active).has(parent)).toBe(true)
        expect(yield* forms.state(request.id)).toEqual({ status: "pending" })
        yield* TestClock.adjust("2 minutes")
        expect(yield* forms.state(request.id)).toEqual({ status: "cancelled" })
        yield* TestClock.adjust("5 minutes")
        expect((yield* execution.active).has(parent)).toBe(false)
      }),
  )
})
