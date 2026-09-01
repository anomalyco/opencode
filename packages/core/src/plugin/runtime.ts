export * as PluginRuntime from "./runtime.js"

import { Context, Effect, Layer } from "effect"
import type { Agent } from "../agent.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import type { Job } from "../job.js"
import type { Location } from "../location.js"
import type { Mcp } from "../mcp/index.js"
import type { PersistentPty } from "../persistent-pty.js"
import type { Session } from "../session.js"

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
  readonly persistentPty: Pick<PersistentPty.Interface, "read">
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

export const defaultCell = makeCell()

export const layerWithCell = (cell: Cell): Layer.Layer<Service> =>
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
        interrupt: (sessionID, options) => require(cell, (runtime) => runtime.session.interrupt(sessionID, options)),
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
      persistentPty: {
        read: (sessionID, lines) => require(cell, (runtime) => runtime.persistentPty.read(sessionID, lines)),
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

export const layer = layerWithCell(defaultCell)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
