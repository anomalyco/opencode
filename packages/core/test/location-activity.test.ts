import type { FileSystem } from "@opencode/core/filesystem"
import { describe, expect } from "bun:test"
import { Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, RcMap, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Form } from "@opencode/core/form"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
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
import { Document, type Entry, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { testEffect } from "./lib/effect"

// Keep real execution ownership, location caching, forms, and eviction. The fixture
// runner asks a question instead of making a model request, then keeps working
// after it is answered. Permission prompts come from `pendingPermissions` and
// config documents from `configEntries`.
const pendingPermissions: Permission.Request[] = []
const configEntries: Entry[] = []
const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        // The fixture only exercises these five Location services.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.mergeAll(
          Layer.succeed(
            Config.Service,
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            { entries: () => Effect.sync(() => [...configEntries]) } as unknown as Config.Interface,
          ),
          Layer.succeed(
            Permission.Service,
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            { list: () => Effect.sync(() => [...pendingPermissions]) } as unknown as Permission.Interface,
          ),
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
                      Effect.andThen(Effect.never),
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
  for (const [count, admission] of [
    [1, "none"],
    [2, "none"],
    [1, "other"],
    [1, "same"],
  ] as const) {
    const newWork = admission !== "none"
    it.effect(
      `interrupts ${count} working executions before eviction (${admission} session admitted during cleanup)`,
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
          // Answered questions no longer hold the location; the executions keep working
          // without producing durable activity.
          yield* Effect.forEach(pending, (form) => forms.reply({ id: form.id, answer: { runtime: "bun" } }))

          yield* TestClock.adjust("1 minute")
          yield* TestClock.adjust("62 minutes")
          // Interruption has started, but slow cleanup still owns the graph.
          expect(Array.from(yield* execution.active).toSorted()).toEqual(sessionIDs.toSorted())
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])

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
  for (const prompt of ["question", "permission"] as const) {
    it.effect(`keeps a location alive while a ${prompt} is pending`, () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const bus = yield* Bus.Service
        const map = yield* LocationServiceMap.Service
        const execution = yield* SessionExecution.Service
        const sessionID = Session.ID.make(`ses_pending_${prompt}`)
        const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/project") })
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
            slug: prompt,
            directory: ref.directory,
            title: `Pending ${prompt}`,
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)

        const created = yield* Deferred.make<Form.Info>()
        const interrupted: SessionEvent.Execution.Interrupted["data"][] = []
        const unsubscribe = yield* bus.listen((event) =>
          Effect.gen(function* () {
            if (event.type === SessionEvent.Execution.Interrupted.type) {
              interrupted.push(Schema.decodeUnknownSync(SessionEvent.Execution.Interrupted.data)(event.data))
            }
            if (event.type !== Form.Event.Created.type) return
            yield* Deferred.succeed(created, Schema.decodeUnknownSync(Form.Event.Created.data)(event.data).form)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
        yield* Effect.addFinalizer(() =>
          execution
            .interrupt(sessionID)
            .pipe(
              Effect.andThen(TestClock.adjust("5 minutes")),
              Effect.andThen(Effect.sync(() => (pendingPermissions.length = 0))),
            ),
        )
        const form = yield* Deferred.await(created)
        const forms = Context.get(yield* map.contextEffect(ref).pipe(Effect.scoped), Form.Service)
        if (prompt === "permission") {
          yield* forms.reply({ id: form.id, answer: { runtime: "bun" } })
          pendingPermissions.push({ id: Permission.ID.create(), sessionID, action: "bash", resources: ["*"] })
        }

        // Waiting on a human produces no durable activity, but must not count as idle.
        yield* TestClock.adjust("1 minute")
        yield* TestClock.adjust("3 hours")
        expect(Array.from(yield* execution.active)).toEqual([sessionID])
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
        expect(interrupted).toEqual([])
        if (prompt === "question") expect(yield* forms.list()).toEqual([form])

        // Once answered, the usual inactivity deadline applies again.
        if (prompt === "question") yield* forms.reply({ id: form.id, answer: { runtime: "bun" } })
        else pendingPermissions.length = 0
        yield* TestClock.adjust("62 minutes")
        yield* TestClock.adjust("5 minutes")
        expect((yield* Fiber.join(running))._tag).toBe("Failure")
        expect(interrupted).toEqual([{ sessionID, reason: "inactivity" }])
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      }),
    )
  }

  for (const timeout of ["10 minutes", "Infinity"] as const) {
    it.effect(`honors experimental.location_idle_timeout (${timeout})`, () =>
      Effect.gen(function* () {
        const map = yield* LocationServiceMap.Service
        const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/configured") })
        yield* Effect.addFinalizer(() => Effect.sync(() => (configEntries.length = 0)))
        configEntries.push(
          new Document({
            type: "document",
            info: new Info({
              experimental: new ConfigExperimental.Info({ location_idle_timeout: Duration.fromInputUnsafe(timeout) }),
            }),
          }),
        )
        yield* Location.Service.pipe(Effect.provide(map.get(ref)), Effect.scoped)

        // The first sweep starts the location's clock.
        yield* TestClock.adjust("1 minute")
        yield* TestClock.adjust("9 minutes")
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
        yield* TestClock.adjust("1 minute")
        if (timeout === "10 minutes") {
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
          return
        }
        yield* TestClock.adjust("3 hours")
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
      }),
    )
  }
})
