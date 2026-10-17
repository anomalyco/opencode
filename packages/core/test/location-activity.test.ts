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
// runner waits on a form or a silent effect instead of making a model request.
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
                      Effect.andThen(sessionID.endsWith("_silent") ? Effect.never : Effect.void),
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
  for (const [count, completion] of [
    [1, "answer"],
    [2, "answer"],
    [1, "stop"],
    [1, "silent"],
  ] as const) {
    it.effect(
      `retains ${count} process-owned executions across inactivity sweeps until ${completion} releases ownership`,
      () =>
        Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const bus = yield* Bus.Service
          const map = yield* LocationServiceMap.Service
          const execution = yield* SessionExecution.Service
          const store = yield* SessionStore.Service
          const sessionIDs = Array.from({ length: count }, (_, index) =>
            Session.ID.make(`ses_waiting_question_${index}_${completion}`),
          )
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
              sessionIDs.map((sessionID) => ({
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
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const running = yield* Effect.forEach(sessionIDs, (sessionID) =>
            execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped),
          )
          yield* Effect.addFinalizer(() =>
            Effect.forEach(sessionIDs, (sessionID) => execution.interrupt(sessionID)).pipe(
              Effect.andThen(TestClock.adjust("5 minutes")),
            ),
          )
          yield* Deferred.await(created)
          const context = yield* map.contextEffect(ref).pipe(Effect.scoped)
          const forms = Context.get(context, Form.Service)
          expect((yield* store.listSuspended()).toSorted()).toEqual(sessionIDs.toSorted())
          yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)

          // Answering this fixture leaves a silent drain (like a tool with no progress events).
          if (completion === "silent") {
            yield* forms.reply({ id: pending[0].id, answer: { runtime: "bun" } })
          }

          // Human input produces no durable activity while the question is pending.
          yield* TestClock.adjust("1 minute")
          yield* TestClock.adjust("62 minutes")
          yield* TestClock.adjust("62 minutes")
          expect(Array.from(yield* execution.active).toSorted()).toEqual(sessionIDs.toSorted())
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
          expect(interrupted).toEqual([])
          // Resolve through the routed graph, not merely a retained reference to an evicted graph.
          const retained = yield* map.contextEffect(ref).pipe(Effect.scoped)
          expect(Context.get(retained, Form.Service)).toBe(forms)
          expect(yield* forms.list()).toEqual(completion === "silent" ? [] : pending)

          if (completion === "answer") {
            yield* Effect.forEach(pending, (form) => forms.reply({ id: form.id, answer: { runtime: "bun" } }))
            for (const form of pending) {
              expect(yield* forms.state(form.id)).toEqual({ status: "answered", answer: { runtime: "bun" } })
            }
          }
          if (completion !== "answer") {
            // Cross the next expiry deadline while explicit Stop's finalizer is still running.
            yield* TestClock.adjust("55 minutes")
            expect(yield* execution.interrupt(sessionIDs[0])).toBe(true)
            yield* TestClock.adjust("2 minutes")
            expect(Array.from(yield* execution.active)).toEqual(sessionIDs)
            expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
            expect(Context.get(yield* map.contextEffect(ref).pipe(Effect.scoped), Form.Service)).toBe(forms)
            if (completion === "stop") expect(yield* forms.state(pending[0].id)).toEqual({ status: "cancelled" })
            yield* TestClock.adjust("5 minutes")
          }
          const results = yield* Effect.forEach(running, Fiber.join)
          expect(results.every((exit) => exit._tag === (completion === "answer" ? "Success" : "Failure"))).toBe(true)
          expect(Array.from(yield* execution.active)).toEqual([])
          expect(yield* store.listSuspended()).toEqual([])
          expect(interrupted).toEqual(completion === "answer" ? [] : [{ sessionID: sessionIDs[0], reason: "user" }])
          yield* TestClock.adjust("62 minutes")
          expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
        }),
    )
  }
})
