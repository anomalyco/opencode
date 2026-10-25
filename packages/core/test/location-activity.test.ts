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
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { testEffect } from "./lib/effect"

// Per-workspace experimental.location_idle_timeout, read by each location's Config.
const idleTimeouts = new Map<string, Duration.Duration | false>()

// Keep real execution ownership, location caching, forms, and eviction. The fixture
// runner waits on a form instead of making a model request before asking a question.
const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        // The fixture only exercises these four Location services.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        Layer.mergeAll(
          Config.testLayer(
            idleTimeouts.has(ref.workspaceID ?? "")
              ? [
                  new Document({
                    type: "document",
                    info: new Info({
                      experimental: new ConfigExperimental.Info({
                        location_idle_timeout: idleTimeouts.get(ref.workspaceID ?? ""),
                      }),
                    }),
                  }),
                ]
              : [],
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
  for (const count of [1, 2]) {
    it.effect(`keeps a location with ${count} executions waiting on a question until they go idle`, () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const bus = yield* Bus.Service
        const map = yield* LocationServiceMap.Service
        const execution = yield* SessionExecution.Service
        const store = yield* SessionStore.Service
        const sessionIDs = Array.from({ length: count }, (_, index) => Session.ID.make(`ses_waiting_question_${index}`))
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
        yield* Deferred.await(created)
        const context = yield* map.contextEffect(ref).pipe(Effect.scoped)
        const forms = Context.get(context, Form.Service)
        yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)

        // Human input produces no durable activity while the question is pending.
        yield* TestClock.adjust("1 minute")
        yield* TestClock.adjust("62 minutes")
        // The idle sibling expired in the same sweep; the waiting executions keep theirs.
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
        expect(Array.from(yield* execution.active).toSorted()).toEqual(sessionIDs.toSorted())
        expect(interrupted).toEqual([])
        expect((yield* forms.list()).map((form) => form.id).toSorted()).toEqual(
          pending.map((form) => form.id).toSorted(),
        )

        yield* Effect.forEach(sessionIDs, (sessionID) => execution.interrupt(sessionID))
        yield* TestClock.adjust("5 minutes")
        const results = yield* Effect.forEach(running, Fiber.join)
        expect(results.every((exit) => exit._tag === "Failure")).toBe(true)
        expect(yield* execution.active).toEqual(new Set())
        expect(yield* store.listSuspended()).toEqual([])
        yield* TestClock.adjust("62 minutes")
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      }),
    )
  }

  for (const owner of ["shell", "subagent child", "subagent parent"] as const)
    it.effect(`keeps a location with a running background job owned by its ${owner} until the job finishes`, () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const map = yield* LocationServiceMap.Service
        const jobs = yield* Job.Service
        const sessionID = Session.ID.make("ses_background_job")
        // The other side of the subagent is unknown, so only the owner's location can keep the graph.
        const missing = Session.ID.make("ses_missing")
        const ref = LocationServiceMap.canonical({ directory: AbsolutePath.make("/project") })
        const idle = Location.Ref.make({ directory: ref.directory, workspaceID: Workspace.ID.make("wrk_idle") })
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
            slug: "background",
            directory: ref.directory,
            title: "Background job",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)
        yield* Location.Service.pipe(Effect.provide(map.get(ref)), Effect.scoped)
        yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)
        const finish = yield* Deferred.make<string>()
        const job = yield* jobs.start({
          id: "job_background",
          type: owner === "shell" ? "shell" : "subagent",
          recovery:
            owner === "shell"
              ? { kind: "shell", sessionID, shellID: "shell_background", command: "sleep 9999" }
              : {
                  kind: "subagent",
                  parentSessionID: owner === "subagent parent" ? sessionID : missing,
                  childSessionID: owner === "subagent child" ? sessionID : missing,
                  agent: "general",
                  description: "Background subagent",
                },
          run: Deferred.await(finish),
        })
        yield* jobs.background(job.id)

        yield* TestClock.adjust("1 minute")
        yield* TestClock.adjust("62 minutes")
        // The idle sibling expired in the same sweep; the job keeps its location.
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
        expect((yield* jobs.get(job.id))?.status).toBe("running")

        yield* Deferred.succeed(finish, "done")
        yield* jobs.wait({ id: job.id })
        yield* TestClock.adjust("62 minutes")
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      }),
    )

  for (const [timeout, after, evicted] of [
    ["10 minutes", "11 minutes", true],
    [false, "3 hours", false],
  ] as const)
    it.effect(`honors experimental.location_idle_timeout = ${JSON.stringify(timeout)}`, () =>
      Effect.gen(function* () {
        const map = yield* LocationServiceMap.Service
        const workspaceID = Workspace.ID.make(`wrk_timeout_${String(timeout).replace(" ", "_")}`)
        idleTimeouts.set(workspaceID, timeout === false ? false : Duration.fromInputUnsafe(timeout))
        yield* Effect.addFinalizer(() => Effect.sync(() => idleTimeouts.delete(workspaceID)))
        const configured = Location.Ref.make({ directory: AbsolutePath.make("/project"), workspaceID })
        const fallback = Location.Ref.make({ directory: AbsolutePath.make("/project") })
        yield* Location.Service.pipe(Effect.provide(map.get(configured)), Effect.scoped)
        yield* Location.Service.pipe(Effect.provide(map.get(fallback)), Effect.scoped)

        yield* TestClock.adjust("1 minute")
        yield* TestClock.adjust(after)
        const cached = Array.from(yield* RcMap.keys(map.rcMap))
        expect(cached.some((ref) => ref.workspaceID === workspaceID)).toBe(!evicted)
        // Locations without the setting keep the 60 minute default.
        expect(cached.some((ref) => ref.workspaceID === undefined)).toBe(
          Duration.toMinutes(Duration.fromInputUnsafe(after)) < 60,
        )
      }),
    )
})
