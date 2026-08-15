import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Command } from "@opencode-ai/core/command"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Job } from "@opencode-ai/core/job"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Model } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = Model.Ref.make({ id: Model.ID.make("sonnet"), providerID: Provider.ID.make("anthropic") })
const reviewer = Agent.ID.make("reviewer")
const commands = Layer.mock(Command.Service, {
  get: (name) => {
    if (name === "review")
      return Effect.succeed(
        Command.Info.make({
          name,
          template: "Review this",
          description: "review changes",
          agent: reviewer,
        }),
      )
    return Effect.succeed(undefined)
  },
  evaluate: () => Effect.succeed({ text: "Review this" }),
})
const agents = Layer.mock(Agent.Service, {
  get: (id) =>
    Effect.succeed(
      id === reviewer ? Agent.Info.make({ ...Agent.Info.default(id), mode: "subagent", model }) : undefined,
    ),
})
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      // This endpoint only needs the Location-scoped Command and Agent services.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      Layer.merge(commands, agents) as unknown as Layer.Layer<LocationServices>,
  ),
)
const projects = Layer.mock(Project.Service, {
  resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
})
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.never,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    awaitIdle: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Job.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [LocationServiceMap.node, locations],
      [Project.node, projects],
      [SessionExecution.node, execution],
    ],
  ),
)

describe("Session.command", () => {
  it.effect("runs commands targeting subagent-mode agents in background child sessions", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ location, model })

      const admitted = yield* sessions.command({ sessionID: parent.id, command: "review" })
      const children = yield* sessions.list({ parentID: parent.id })

      expect(children.data).toHaveLength(1)
      expect(children.data[0]).toMatchObject({
        parentID: parent.id,
        title: "review changes",
        agent: reviewer,
        model,
      })
      expect(admitted).toMatchObject({ sessionID: children.data[0]!.id, payload: { text: "Review this" } })
      expect(yield* Job.Service.use((jobs) => jobs.get(children.data[0]!.id))).toMatchObject({
        id: children.data[0]!.id,
        type: "subagent",
        status: "running",
      })
      expect(yield* sessions.inbox(parent.id)).toEqual([
        expect.objectContaining({
          type: "synthetic",
          payload: expect.objectContaining({ text: expect.stringContaining(children.data[0]!.id) }),
        }),
      ])
    }),
  )
})
