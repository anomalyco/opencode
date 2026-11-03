import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer, Scope, Tracer } from "effect"
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
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

function spanRecorder() {
  const spans: Array<{ readonly span: Tracer.NativeSpan; readonly fiberID: number | undefined }> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push({ span, fiberID: Fiber.getCurrent()?.id })
      return span
    },
  })
  return {
    tracer,
    activateSpans: () => spans.filter((entry) => entry.span.name === "Project.activate"),
  }
}

describe("Project.activate throttling", () => {
  it.effect("stays lazy and skips spans and forks on throttled repeats", () =>
    Effect.gen(function* () {
      const { tracer, activateSpans } = spanRecorder()
      let currentNow = 100_000
      const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Project.node]), [
        Global.node.replace(tempGlobalLayer),
        Project.node.replace(Project.configured({ now: () => currentNow })),
      ])

      yield* Effect.gen(function* () {
        const callerID = Fiber.getCurrent()?.id
        const db = (yield* Database.Service).db
        const project = yield* Project.Service
        const forkScope = yield* Scope.make()
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

        // Building the effect without executing it must not consume the throttle window.
        const unused = project.activate(id)
        expect(unused).toBeDefined()

        for (let i = 0; i < 25; i++) {
          yield* project.activate(id, { forkIn: forkScope })
        }
        yield* Effect.yieldNow
        yield* Scope.close(forkScope, Exit.void)
        expect(activateSpans()).toHaveLength(1)
        expect(activateSpans()[0]?.fiberID).not.toBe(callerID)
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

      expect(activateSpans()).toHaveLength(2)
    }),
  )

  it.effect("ignores non-matching bus traffic and throttles durable lifecycle updates", () =>
    Effect.gen(function* () {
      const { tracer, activateSpans } = spanRecorder()
      let currentNow = 200_000
      const targetRef = Location.Ref.make({ directory: AbsolutePath.make("/repo/one") })
      const otherRef = Location.Ref.make({ directory: AbsolutePath.make("/repo/two") })

      const layer = AppNodeBuilder.build(LayerNode.group([Bus.node, LocationLifecycle.node]), [
        Global.node.replace(tempGlobalLayer),
        Location.node.replace(Location.boundNode(targetRef)),
        Project.node.replace(Project.configured({ now: () => currentNow })),
      ])

      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        const sessionID = SessionID.make("ses_test123456")
        const messageID = SessionMessage.ID.make("msg_test123456")
        expect(activateSpans()).toHaveLength(1)

        for (let i = 0; i < 10; i++) {
          yield* bus.publish(
            SessionEvent.Text.Delta,
            { sessionID, assistantMessageID: messageID, ordinal: NonNegativeInt.make(0), delta: "hi" },
            { location: targetRef },
          )
          yield* bus.publish(
            SessionEvent.AgentSelected,
            { sessionID, agent: Agent.ID.make("build") },
            { location: otherRef },
          )
          yield* bus.publish(
            SessionEvent.AgentSelected,
            { sessionID, agent: Agent.ID.make("build") },
            { location: targetRef },
          )
        }
        yield* Effect.yieldNow
        expect(activateSpans()).toHaveLength(1)

        currentNow += Project.ACTIVATE_INTERVAL
        yield* bus.publish(
          SessionEvent.AgentSelected,
          { sessionID, agent: Agent.ID.make("build") },
          { location: targetRef },
        )
        yield* Effect.yieldNow
      }).pipe(Effect.provide(layer), Effect.provideService(Tracer.Tracer, tracer))

      expect(activateSpans()).toHaveLength(2)
    }),
  )
})
