import { describe, expect } from "bun:test"
import { Effect, Layer, Tracer } from "effect"
import { Agent } from "@opencode/schema/agent"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { LocationLifecycle } from "@opencode/core/location-lifecycle"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath, NonNegativeInt } from "@opencode/core/schema"
import { SessionEvent } from "@opencode/core/session/event"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempGlobalLayer } from "./fixture/global"
import { Global } from "@opencode/util/global"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

describe("Project.activate throttling", () => {
  it.effect("does not emit Project.activate spans on throttled repeats", () =>
    Effect.gen(function* () {
      const spans: Tracer.NativeSpan[] = []
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options)
          spans.push(span)
          return span
        },
      })

      let currentNow = 100_000
      const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Project.node]), [
        Global.node.replace(tempGlobalLayer),
        Project.node.replace(Project.configured({ now: () => currentNow })),
      ])

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const project = yield* Project.Service
        const id = Project.ID.make("proj_throttled")
        yield* db
          .insert(ProjectTable)
          .values({
            id,
            worktree: AbsolutePath.make("/repo"),
            sandboxes: [],
            time_created: 1,
            time_updated: 1,
            time_active: 1,
          })
          .run()

        for (let i = 0; i < 25; i++) {
          yield* project.activate(id)
        }
        expect((yield* project.list())[0]?.time.active).toBe(100_000)

        currentNow += Project.ACTIVATE_INTERVAL - 1
        yield* project.activate(id)
        expect((yield* project.list())[0]?.time.active).toBe(100_000)

        currentNow += 1
        for (let i = 0; i < 10; i++) {
          yield* project.activate(id)
        }
        expect((yield* project.list())[0]?.time.active).toBe(100_000 + Project.ACTIVATE_INTERVAL)
      }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.provide(layer))

      expect(spans.filter((span) => span.name === "Project.activate")).toHaveLength(2)
    }),
  )

  it.effect("ignores non-matching bus traffic and skips throttled lifecycle forks", () =>
    Effect.gen(function* () {
      const spans: Tracer.NativeSpan[] = []
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options)
          spans.push(span)
          return span
        },
      })

      const targetRef = Location.Ref.make({ directory: AbsolutePath.make("/repo/one") })
      const otherRef = Location.Ref.make({ directory: AbsolutePath.make("/repo/two") })

      let activateCalls = 0
      let nonVoidActivations = 0
      const countingProject = Project.node.mapLayer((projectLayer) =>
        Layer.effect(
          Project.Service,
          Effect.gen(function* () {
            const base = yield* Project.Service
            return Project.Service.of({
              ...base,
              activate: (projectID) => {
                activateCalls++
                const effect = base.activate(projectID)
                if (effect !== Effect.void) nonVoidActivations++
                return effect
              },
            })
          }),
        ).pipe(Layer.provide(projectLayer)),
      )

      const layer = AppNodeBuilder.build(LayerNode.group([Bus.node, LocationLifecycle.node]), [
        Global.node.replace(tempGlobalLayer),
        Location.node.replace(Location.boundNode(targetRef)),
        Project.node.replace(countingProject),
      ])

      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        const sessionID = SessionID.make("ses_test123456")
        const messageID = SessionMessage.ID.make("msg_test123456")

        // Booting LocationLifecycle activates once.
        expect(activateCalls).toBe(1)

        // Ephemeral events on the same Location must never trigger project.activate.
        for (let i = 0; i < 10; i++) {
          yield* bus.publish(
            SessionEvent.Text.Delta,
            { sessionID, assistantMessageID: messageID, ordinal: NonNegativeInt.make(0), delta: "hi" },
            { location: targetRef },
          )
        }

        // Durable events for another Location must never trigger project.activate here.
        for (let i = 0; i < 10; i++) {
          yield* bus.publish(
            SessionEvent.AgentSelected,
            { sessionID, agent: Agent.ID.make("build") },
            { location: otherRef },
          )
        }

        expect(activateCalls).toBe(1)

        // Durable events for this Location within the 60s window return Effect.void without spans or forks.
        for (let i = 0; i < 10; i++) {
          yield* bus.publish(
            SessionEvent.AgentSelected,
            { sessionID, agent: Agent.ID.make("build") },
            { location: targetRef },
          )
        }
        yield* Effect.yieldNow
        expect(activateCalls).toBe(11)
        expect(nonVoidActivations).toBe(1)
      }).pipe(Effect.provide(layer), Effect.provideService(Tracer.Tracer, tracer))

      expect(spans.filter((span) => span.name === "Project.activate")).toHaveLength(1)
    }),
  )
})
