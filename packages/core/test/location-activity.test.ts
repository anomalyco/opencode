import { describe, expect } from "bun:test"
import { Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, RcMap, Schema } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { Form } from "@opencode-ai/core/form"
import { Location } from "@opencode-ai/core/location"
import { LocationActivity } from "@opencode-ai/core/location-activity"
import { LocationServiceMap, type LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunner } from "@opencode-ai/core/session/runner/index"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Workspace } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"

// Keep real execution ownership, location caching, forms, and eviction. The fixture
// runner waits on a form instead of making a model request before asking a question.
const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return yield* LayerMap.make(
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
                    .pipe(Effect.orDie, Effect.as(SessionRunner.DrainResult.Complete())),
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
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, LocationServiceMap.node, SessionExecution.node, LocationActivity.node]),
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

describe("LocationActivity active execution", () => {
  for (const settle of ["answer", "cancel", "interrupt"] as const) {
    it.effect(`keeps a waiting question reachable past the deadline until ${settle}`, () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const bus = yield* Bus.Service
        const map = yield* LocationServiceMap.Service
        const execution = yield* SessionExecution.Service
        const sessionID = Session.ID.make("ses_waiting_question")
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
            slug: "question",
            directory: ref.directory,
            title: "Waiting question",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)

        const created = yield* Deferred.make<Form.Info>()
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Form.Event.Created.type
            ? Deferred.succeed(created, Schema.decodeUnknownSync(Form.Event.Created.data)(event.data).form).pipe(
                Effect.asVoid,
              )
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const running = yield* execution.resume(sessionID).pipe(Effect.exit, Effect.forkScoped)
        const form = yield* Deferred.await(created)
        yield* Location.Service.pipe(Effect.provide(map.get(idle)), Effect.scoped)

        // The first sweep discovers both cached graphs. No more Session events
        // are needed while the human is deciding how to answer.
        yield* TestClock.adjust("1 minute")
        yield* TestClock.adjust("62 minutes")
        expect(yield* execution.isActive(sessionID)).toBe(true)
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([ref])
        const context = yield* map.contextEffect(ref).pipe(Effect.scoped)
        const forms = Context.get(context, Form.Service)
        expect(yield* forms.list({ sessionID })).toEqual([form])

        if (settle === "answer") yield* forms.reply({ id: form.id, answer: { runtime: "Bun" } })
        if (settle === "cancel") yield* forms.cancel(form.id)
        if (settle === "interrupt") yield* execution.interrupt(sessionID)
        yield* Fiber.join(running)
        yield* execution.awaitIdle(sessionID)
        expect(yield* forms.state(form.id)).toEqual(
          settle === "answer" ? { status: "answered", answer: { runtime: "Bun" } } : { status: "cancelled" },
        )

        yield* TestClock.adjust("62 minutes")
        expect(Array.from(yield* RcMap.keys(map.rcMap))).toEqual([])
      }),
    )
  }
})
