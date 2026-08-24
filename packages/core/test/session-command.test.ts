import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Catalog } from "@opencode-ai/core/catalog"
import { Command } from "@opencode-ai/core/command"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Model } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const providerID = Provider.ID.make("openai")
const supplied = Model.Ref.make({
  providerID,
  id: Model.ID.make("model-a"),
  variant: Model.VariantID.make("xhigh"),
})
const sameModel = Model.Ref.make({ providerID, id: supplied.id })
const supported = Model.Ref.make({ providerID: Provider.ID.anthropic, id: Model.ID.make("model-b") })
const unsupported = Model.Ref.make({ providerID: Provider.ID.make("google"), id: Model.ID.make("model-c") })
const explicitAgent = Model.Ref.make({ ...supported, variant: Model.VariantID.make("high") })
const explicitCommand = Model.Ref.make({ ...supported, variant: Model.VariantID.make("medium") })
const variant = (id: string) => ({ id: Model.VariantID.make(id) })
const catalogModels = [
  Model.Info.make({ ...Model.Info.default(sameModel.providerID, sameModel.id), variants: [variant("xhigh")] }),
  Model.Info.make({
    ...Model.Info.default(supported.providerID, supported.id),
    variants: [variant("xhigh"), variant("high"), variant("medium")],
  }),
  Model.Info.make({ ...Model.Info.default(unsupported.providerID, unsupported.id), variants: [variant("high")] }),
]

const commands = new Map([
  ["inherit", Command.Info.make({ name: "inherit", template: "Inherited", agent: Agent.ID.make("orchestrator") })],
  ["supported", Command.Info.make({ name: "supported", template: "Supported", model: supported })],
  [
    "unsupported",
    Command.Info.make({ name: "unsupported", template: "Unsupported", agent: Agent.ID.make("unsupported") }),
  ],
  [
    "agent-explicit",
    Command.Info.make({ name: "agent-explicit", template: "Agent explicit", agent: Agent.ID.make("high-agent") }),
  ],
  [
    "command-explicit",
    Command.Info.make({
      name: "command-explicit",
      template: "Command explicit",
      agent: Agent.ID.make("orchestrator"),
      model: explicitCommand,
    }),
  ],
])
const agents = new Map([
  [
    Agent.ID.make("orchestrator"),
    Agent.Info.make({ ...Agent.Info.default(Agent.ID.make("orchestrator")), model: sameModel }),
  ],
  [
    Agent.ID.make("high-agent"),
    Agent.Info.make({ ...Agent.Info.default(Agent.ID.make("high-agent")), model: explicitAgent }),
  ],
  [
    Agent.ID.make("unsupported"),
    Agent.Info.make({ ...Agent.Info.default(Agent.ID.make("unsupported")), model: unsupported }),
  ],
])
const accesses: string[] = []

const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      Layer.unwrap(
        Effect.sync(() => {
          let ready = false
          return Layer.mergeAll(
            Layer.mock(Command.Service, {
              get: (name) =>
                Effect.sync(() => {
                  accesses.push("command.get")
                  if (!ready) throw new Error("Command accessed before flush")
                  return commands.get(name)
                }),
              evaluate: (input) =>
                Effect.sync(() => {
                  accesses.push("command.evaluate")
                  if (!ready) throw new Error("Command evaluated before flush")
                  return { text: commands.get(input.name)?.template ?? "" }
                }),
            }),
            Layer.mock(Agent.Service, {
              get: (id) =>
                Effect.sync(() => {
                  accesses.push("agent.get")
                  if (!ready) throw new Error("Agent accessed before flush")
                  return agents.get(id)
                }),
            }),
            Layer.mock(Catalog.Service, {
              provider: {
                get: () => Effect.succeed(undefined),
                all: () => Effect.succeed([]),
                available: () => Effect.succeed([]),
              },
              model: {
                get: (providerID, modelID) =>
                  Effect.succeed(
                    catalogModels.find((model) => model.providerID === providerID && model.id === modelID),
                  ),
                all: () => Effect.succeed(catalogModels),
                available: () => Effect.succeed(catalogModels),
                default: () => Effect.succeed(undefined),
                small: () => Effect.succeed(undefined),
              },
            }),
            Layer.mock(PluginSupervisor.Service, {
              flush: Effect.sync(() => {
                accesses.push("flush")
                ready = true
              }),
            }),
          )
        }),
      ) as unknown as Layer.Layer<LocationServices>,
  ),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [SessionExecution.node, SessionExecution.noopLayer],
      [LocationServiceMap.node, locations],
    ],
  ),
)

const run = (command: string, supplyModel = true) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const sessionID = Session.ID.create()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "command-test",
        directory: "/project",
        title: "Command test",
        version: "test",
        model: supplied,
      })
      .run()
      .pipe(Effect.orDie)
    const session = yield* Session.Service
    yield* session.command({ sessionID, command, ...(supplyModel ? { model: supplied } : {}), resume: false })
    return yield* session.get(sessionID)
  })

describe("Session.command", () => {
  it.effect("flushes plugins before command and agent access", () =>
    Effect.gen(function* () {
      accesses.length = 0
      yield* run("inherit")
      expect(accesses).toEqual(["flush", "command.get", "command.evaluate", "agent.get"])
    }),
  )

  it.effect("preserves the supplied variant for the same command-agent model", () =>
    Effect.gen(function* () {
      expect((yield* run("inherit")).model).toEqual(supplied)
    }),
  )

  it.effect("preserves the selected variant when no model is supplied", () =>
    Effect.gen(function* () {
      expect((yield* run("inherit", false)).model).toEqual(supplied)
    }),
  )

  it.effect("carries the supplied variant to a different model that supports it", () =>
    Effect.gen(function* () {
      expect((yield* run("supported")).model).toEqual({ ...supported, variant: supplied.variant })
    }),
  )

  it.effect("selects the destination default when a different model does not support the variant", () =>
    Effect.gen(function* () {
      expect((yield* run("unsupported")).model).toEqual({
        ...unsupported,
        variant: Model.VariantID.make("default"),
      })
    }),
  )

  it.effect("honors an explicit command-agent variant", () =>
    Effect.gen(function* () {
      expect((yield* run("agent-explicit")).model).toEqual(explicitAgent)
    }),
  )

  it.effect("honors an explicit command variant", () =>
    Effect.gen(function* () {
      expect((yield* run("command-explicit")).model).toEqual(explicitCommand)
    }),
  )
})
