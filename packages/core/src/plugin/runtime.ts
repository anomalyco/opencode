export * as PluginRuntime from "./runtime"

import { Context, Effect, Layer } from "effect"
import { AgentV2 } from "../agent"
import { makeGlobalNode } from "../effect/app-node"
import { Job } from "../job"
import { Location } from "../location"
import { LocationServiceMap } from "../location-service-map"
import { SessionV2 } from "../session"

export interface Interface {
  readonly session: Pick<
    SessionV2.Interface,
    "get" | "create" | "messages" | "prompt" | "generate" | "command" | "resume" | "interrupt" | "synthetic"
  >
  readonly job: Pick<Job.Interface, "start" | "wait" | "block" | "background" | "cancel">
  readonly location: {
    readonly agent: {
      readonly list: (
        ref: Location.Ref,
      ) => Effect.Effect<{ readonly location: Location.Info; readonly data: AgentV2.Info[] }>
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
        resume: (sessionID) => require(cell, (runtime) => runtime.session.resume(sessionID)),
        interrupt: (sessionID) => require(cell, (runtime) => runtime.session.interrupt(sessionID)),
        synthetic: (input) => require(cell, (runtime) => runtime.session.synthetic(input)),
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
      },
    }),
  )

export const providerLayerWithCell = (cell: Cell) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
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
                const agents = yield* AgentV2.Service
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
export const providerLayer = providerLayerWithCell(defaultCell)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

// Raw layer replacements are compiled without dependencies, so cell-scoped
// provider replacements must go through this node to keep their deps wired.
export const providerNodeWithCell = (cell: Cell) =>
  makeGlobalNode({
    name: "plugin-runtime-provider",
    layer: providerLayerWithCell(cell),
    deps: [node, SessionV2.node, Job.node, LocationServiceMap.node],
  })

export const providerNode = providerNodeWithCell(defaultCell)
