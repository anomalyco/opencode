export * as PluginRuntime from "./runtime.js"

import { Context, Effect, Layer } from "effect"
import { Agent } from "../agent.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Job } from "../job.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"
import { Mcp } from "../mcp/index.js"
import { Session } from "../session.js"

export interface Interface {
  readonly session: Pick<
    Session.Interface,
    | "get"
    | "create"
    | "messages"
    | "prompt"
    | "generate"
    | "command"
    | "rename"
    | "move"
    | "resume"
    | "switchAgent"
    | "switchModel"
    | "interrupt"
    | "synthetic"
    | "wait"
    | "context"
  >
  readonly job: Pick<Job.Interface, "start" | "wait" | "block" | "background" | "cancel" | "completeBackground">
  readonly location: {
    readonly agent: {
      readonly list: (
        ref: Location.Ref,
      ) => Effect.Effect<{ readonly location: Location.Info; readonly data: Agent.Info[] }>
    }
    readonly mcp: {
      readonly list: (
        ref: Location.Ref,
      ) => Effect.Effect<{ readonly location: Location.Info; readonly data: Mcp.ServerInfo[] }, unknown>
    }
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginRuntime") {}

export interface Cell {
  runtime?: Interface
}

export const makeCell = (): Cell => ({})

const require = <A, E, R>(cell: Cell, f: (runtime: Interface) => Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const runtime = cell.runtime
    if (runtime === undefined) return Effect.die(new Error("Plugin runtime is unavailable"))
    return f(runtime)
  })

const defaultCell = makeCell()

export const layerWithCell = (cell: Cell) =>
  Layer.succeed(
    Service,
    Service.of({
      session: {
        get: (sessionID) => require(cell, (runtime) => runtime.session.get(sessionID)),
        create: (input) => require(cell, (runtime) => runtime.session.create(input)),
        messages: (input) => require(cell, (runtime) => runtime.session.messages(input)),
        prompt: (input) => require(cell, (runtime) => runtime.session.prompt(input)),
        generate: (input) => require(cell, (runtime) => runtime.session.generate(input)),
        command: (input) => require(cell, (runtime) => runtime.session.command(input)),
        rename: (input) => require(cell, (runtime) => runtime.session.rename(input)),
        move: (input) => require(cell, (runtime) => runtime.session.move(input)),
        resume: (sessionID) => require(cell, (runtime) => runtime.session.resume(sessionID)),
        switchAgent: (input) => require(cell, (runtime) => runtime.session.switchAgent(input)),
        switchModel: (input) => require(cell, (runtime) => runtime.session.switchModel(input)),
        interrupt: (sessionID) => require(cell, (runtime) => runtime.session.interrupt(sessionID)),
        synthetic: (input) => require(cell, (runtime) => runtime.session.synthetic(input)),
        wait: (sessionID) => require(cell, (runtime) => runtime.session.wait(sessionID)),
        context: (sessionID) => require(cell, (runtime) => runtime.session.context(sessionID)),
      },
      job: {
        start: (input) => require(cell, (runtime) => runtime.job.start(input)),
        wait: (input) => require(cell, (runtime) => runtime.job.wait(input)),
        block: (input) => require(cell, (runtime) => runtime.job.block(input)),
        background: (id) => require(cell, (runtime) => runtime.job.background(id)),
        cancel: (id) => require(cell, (runtime) => runtime.job.cancel(id)),
        completeBackground: (notificationID) =>
          require(cell, (runtime) => runtime.job.completeBackground(notificationID)),
      },
      location: {
        agent: {
          list: (ref) => require(cell, (runtime) => runtime.location.agent.list(ref)),
        },
        mcp: {
          list: (ref) => require(cell, (runtime) => runtime.location.mcp.list(ref)),
        },
      },
    }),
  )

export const providerLayerWithCell = (cell: Cell) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const locations = yield* LocationServiceMap.Service
      const runtime: Interface = {
        session: sessions,
        job: jobs,
        location: {
          agent: {
            list: (ref) =>
              Effect.gen(function* () {
                const location = yield* Location.Service
                const agents = yield* Agent.Service
                return {
                  location: new Location.Info({
                    directory: location.directory,
                    workspaceID: location.workspaceID,
                    project: location.project,
                  }),
                  data: yield* agents.list(),
                }
              }).pipe(Effect.provide(locations.get(ref)), Effect.orDie),
          },
          mcp: {
            list: (ref) =>
              Effect.gen(function* () {
                const location = yield* Location.Service
                const mcp = yield* Mcp.Service
                return {
                  location: new Location.Info({
                    directory: location.directory,
                    workspaceID: location.workspaceID,
                    project: location.project,
                  }),
                  data: yield* mcp.servers(),
                }
              }).pipe(Effect.provide(locations.get(ref))),
          },
        },
      }
      cell.runtime = runtime
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (cell.runtime === runtime) cell.runtime = undefined
        }),
      )
    }),
  )

export const layer = layerWithCell(defaultCell)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

// Raw layer replacements are compiled without dependencies, so cell-scoped
// provider replacements must go through this node to keep their deps wired.
export const providerNodeWithCell = (cell: Cell) =>
  makeGlobalNode({
    name: "plugin-runtime-provider",
    layer: providerLayerWithCell(cell),
    deps: [node, Session.node, Job.node, LocationServiceMap.node],
  })

export const providerNode = providerNodeWithCell(defaultCell)
