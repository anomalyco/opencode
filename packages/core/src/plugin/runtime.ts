export * as PluginRuntime from "./runtime.js"

import { Context, Effect, Layer } from "effect"
import { Agent } from "../agent.js"
import { Mcp } from "@opencode-ai/schema/mcp"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Job } from "../job.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"
import { MCP } from "../mcp/index.js"
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
    | "resume"
    | "interrupt"
    | "synthetic"
    | "wait"
  >
  readonly job: Pick<Job.Interface, "start" | "wait" | "block" | "background" | "cancel">
  readonly location: {
    readonly agent: {
      readonly list: (
        ref: Location.Ref,
      ) => Effect.Effect<{ readonly location: Location.Info; readonly data: Agent.Info[] }>
    }
    readonly mcp: {
      readonly list: (
        ref: Location.Ref,
      ) => Effect.Effect<{ readonly location: Location.Info; readonly data: MCP.ServerInfo[] }, unknown>
      readonly add: (ref: Location.Ref, server: string, config: Mcp.ServerConfig) => Effect.Effect<void, unknown>
      readonly remove: (ref: Location.Ref, server: string) => Effect.Effect<void, unknown>
      readonly connect: (ref: Location.Ref, server: string) => Effect.Effect<void, unknown>
      readonly disconnect: (ref: Location.Ref, server: string) => Effect.Effect<void, unknown>
    }
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginRuntime") {}

export interface Cell {
  runtime?: Interface
}

export const makeCell = (): Cell => ({})

const unavailable = <A, E, R>() => Effect.die(new Error("Plugin runtime is unavailable")) as Effect.Effect<A, E, R>
const require = <A, E, R>(cell: Cell, f: (runtime: Interface) => Effect.Effect<A, E, R>) =>
  Effect.suspend(() => {
    const runtime = cell.runtime
    if (runtime === undefined) return unavailable<A, E, R>()
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
        resume: (sessionID) => require(cell, (runtime) => runtime.session.resume(sessionID)),
        interrupt: (sessionID) => require(cell, (runtime) => runtime.session.interrupt(sessionID)),
        synthetic: (input) => require(cell, (runtime) => runtime.session.synthetic(input)),
        wait: (sessionID) => require(cell, (runtime) => runtime.session.wait(sessionID)),
      },
      job: {
        start: (input) => require(cell, (runtime) => runtime.job.start(input)),
        wait: (input) => require(cell, (runtime) => runtime.job.wait(input)),
        block: (input) => require(cell, (runtime) => runtime.job.block(input)),
        background: (id) => require(cell, (runtime) => runtime.job.background(id)),
        cancel: (id) => require(cell, (runtime) => runtime.job.cancel(id)),
      },
      location: {
        agent: {
          list: (ref) => require(cell, (runtime) => runtime.location.agent.list(ref)),
        },
        mcp: {
          list: (ref) => require(cell, (runtime) => runtime.location.mcp.list(ref)),
          add: (ref, server, config) => require(cell, (runtime) => runtime.location.mcp.add(ref, server, config)),
          remove: (ref, server) => require(cell, (runtime) => runtime.location.mcp.remove(ref, server)),
          connect: (ref, server) => require(cell, (runtime) => runtime.location.mcp.connect(ref, server)),
          disconnect: (ref, server) => require(cell, (runtime) => runtime.location.mcp.disconnect(ref, server)),
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
                const mcp = yield* MCP.Service
                return {
                  location: new Location.Info({
                    directory: location.directory,
                    workspaceID: location.workspaceID,
                    project: location.project,
                  }),
                  data: yield* mcp.servers(),
                }
              }).pipe(Effect.provide(locations.get(ref))),
            add: (ref, server, config) =>
              MCP.Service.use((mcp) => mcp.add(server, config)).pipe(Effect.provide(locations.get(ref))),
            remove: (ref, server) =>
              MCP.Service.use((mcp) => mcp.remove(server)).pipe(Effect.provide(locations.get(ref))),
            connect: (ref, server) =>
              MCP.Service.use((mcp) => mcp.connect(server)).pipe(Effect.provide(locations.get(ref))),
            disconnect: (ref, server) =>
              MCP.Service.use((mcp) => mcp.disconnect(server)).pipe(Effect.provide(locations.get(ref))),
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
