import type { FileSystem } from "@opencode/core/filesystem"
import { describe, expect } from "bun:test"
import { Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, RcMap, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
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
                  forms
                    .ask({
                      sessionID,
                      title: "Questions",
                      fields: [{ key: "runtime", type: "string" }],
                    })
                    .pipe(
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
        ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
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
      Job.node,
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

describe("LocationActivity eviction", () => {
  it.effect("keeps a running background shell's location but evicts its idle parent location", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const map = yield* LocationServiceMap.Service
      const jobs = yield* Job.Service
      const parent = Session.ID.make("ses_background_parent")
      const child = Session.ID.make("ses_background_child")
      const shell = Session.ID.make("ses_background_shell")
      const parentRef = LocationServiceMap.canonical({ directory: AbsolutePath.make("/parent") })
      const shellRef = LocationServiceMap.canonical({ directory: AbsolutePath.make("/shell") })
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: parentRef.directory, sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values([
          {
            id: parent,
            project_id: Project.ID.global,
            slug: "parent",
            directory: parentRef.directory,
            title: "Parent",
            version: "test",
          },
          {
            id: child,
            project_id: Project.ID.global,
            slug: "child",
            directory: AbsolutePath.make("/child"),
            title: "Child",
            version: "test",
            parent_id: parent,
          },
          {
            id: shell,
            project_id: Project.ID.global,
            slug: "shell",
            directory: shellRef.directory,
            title: "Shell",
            version: "test",
          },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* Location.Service.pipe(Effect.provide(map.get(parentRef)), Effect.scoped)
      yield* Location.Service.pipe(Effect.provide(map.get(shellRef)), Effect.scoped)

      const shellDone = yield* Deferred.make<string>()
      yield* jobs.start({
        id: "background-shell",
        type: "shell",
        location: shellRef,
        recovery: { kind: "shell", sessionID: shell, shellID: "background-shell", command: "sleep" },
        run: Deferred.await(shellDone),
      })
      yield* jobs.background("background-shell")
      const childDone = yield* Deferred.make<string>()
      yield* jobs.start({
        id: child,
        type: "subagent",
        recovery: {
          kind: "subagent",
          parentSessionID: parent,
          childSessionID: child,
          agent: "test",
          description: "Child",
        },
        run: Deferred.await(childDone),
      })
      yield* jobs.background(child)

      yield* TestClock.adjust("1 minute")
      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([shellRef])
      expect((yield* jobs.get(child))?.status).toBe("running")
      expect((yield* jobs.get("background-shell"))?.status).toBe("running")

      yield* Deferred.succeed(shellDone, "done")
      yield* jobs.wait({ id: "background-shell" })
      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      yield* Deferred.succeed(childDone, "done")
    }),
  )

  it.effect("keeps a location when a background shell starts during eviction cleanup", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const bus = yield* Bus.Service
      const map = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const jobs = yield* Job.Service
      const sessionID = Session.ID.make("ses_shell_during_cleanup")
      const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/cleanup") })
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: ref.directory, sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "cleanup",
          directory: ref.directory,
          title: "Cleanup",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const created = yield* Deferred.make<void>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Form.Event.Created.type ? Deferred.succeed(created, undefined).pipe(Effect.asVoid) : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(created)
      yield* TestClock.adjust("1 minute")
      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* execution.active)).toEqual([sessionID])

      const done = yield* Deferred.make<string>()
      yield* jobs.start({
        id: "shell-during-cleanup",
        type: "shell",
        location: ref,
        recovery: { kind: "shell", sessionID, shellID: "shell-during-cleanup", command: "sleep" },
        run: Deferred.await(done),
      })
      yield* jobs.background("shell-during-cleanup")
      yield* TestClock.adjust("5 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      expect((yield* Fiber.join(running))._tag).toBe("Failure")
      yield* Deferred.succeed(done, "done")
      yield* jobs.wait({ id: "shell-during-cleanup" })
      yield* TestClock.adjust("62 minutes")
      expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
    }),
  )

  for (const [count, admission] of [
    [1, "none"],
    [2, "none"],
    [1, "other"],
    [1, "same"],
  ] as const) {
    const newWork = admission !== "none"
    it.effect(
      `interrupts ${count} waiting executions before eviction (${admission} session admitted during cleanup)`,
      () =>
        Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const bus = yield* Bus.Service
          const map = yield* LocationServiceMap.Service
          const execution = yield* SessionExecution.Service
          const store = yield* SessionStore.Service
          const sessionIDs = Array.from({ length: count }, (_, index) =>
            Session.ID.make(`ses_waiting_question_${index}`),
          )
          const newcomer = admission === "same" ? sessionIDs[0] : Session.ID.make("ses_new_question")
          const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/project") })
          const idle = Location.Ref.make({ directory: ref.directory, workspaceID: Workspace.ID.make("wrk_idle") })
          yield* db
            .insert(ProjectTable)
            .values({ id: Project.ID.global, worktree: ref.directory, sandboxes: [] })
            .run()
            .pipe(Effect.orDie)
          yield* db
            .insert(SessionTable)
            .values(
              Array.from(new Set([...sessionIDs, newcomer]), (sessionID) => ({
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
              if (pending.length === count) yield* Deferred.succeed(created, undefined)
              if (pending.length > count) yield* Deferred.succeed(newCreated, undefined)
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const running = yield* Effect.forEach(sessionIDs, (sessionID) =>
            execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped),
          )
          yield* Effect.addFinalizer(() =>
            Effect.forEach([...sessionIDs, newcomer], (sessionID) => execution.interrupt(sessionID)).pipe(
              Effect.andThen(TestClock.adjust("5 minutes")),
            ),
          )
          yield* Deferred.await(created)
          const context = yield* map.contextEffect(ref).pipe(Effect.scoped)
          const forms = Context.get(context, Form.Service)
          expect((yield* store.listSuspended()).toSorted()).toEqual(sessionIDs.toSorted())
          yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)

          // Human input produces no durable activity while the question is pending.
          yield* TestClock.adjust("1 minute")
          yield* TestClock.adjust("62 minutes")
          // Interruption has cancelled each question, but slow cleanup still owns the graph.
          expect(Array.from(yield* execution.active).toSorted()).toEqual(sessionIDs.toSorted())
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
          expect(yield* forms.list()).toEqual([])
          for (const form of pending) expect(yield* forms.state(form.id)).toEqual({ status: "cancelled" })

          if (newWork) {
            yield* execution.wake(newcomer)
            if (admission === "other") yield* Deferred.await(newCreated)
          }
          yield* TestClock.adjust("5 minutes")
          if (newWork) yield* Deferred.await(newCreated)
          const results = yield* Effect.forEach(running, Fiber.join)
          expect(results.every((exit) => exit._tag === "Failure")).toBe(true)
          expect(Array.from(yield* execution.active)).toEqual(newWork ? [newcomer] : [])
          expect(yield* store.listSuspended()).toEqual(newWork ? [newcomer] : [])
          expect(interrupted.toSorted((a, b) => a.sessionID.localeCompare(b.sessionID))).toEqual(
            sessionIDs.map((sessionID) => ({ sessionID, reason: "inactivity" })),
          )
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual(newWork ? [ref] : [])
          if (newWork) {
            expect(yield* forms.list({ sessionID: newcomer })).toEqual([pending[count]])
            if (admission === "same") {
              const later = LocationServiceMap.canonical({ directory: AbsolutePath.make("/later") })
              yield* Location.Service.pipe(Effect.provide(map.get(later)), Effect.scoped)
              yield* TestClock.adjust("30 minutes")
              // Keep fresh work active while a different graph reaches its own deadline.
              yield* bus.publish(SessionEvent.Execution.Started, { sessionID: newcomer }, { location: ref })
              yield* TestClock.adjust("32 minutes")
              expect(Array.from(yield* execution.active)).toEqual([newcomer])
              expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
            }
            yield* execution.interrupt(newcomer)
            yield* TestClock.adjust("5 minutes")
            yield* execution.awaitIdle(newcomer)
            yield* TestClock.adjust("62 minutes")
            expect(yield* store.listSuspended()).toEqual([])
            expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
          }
        }),
    )
  }
})
