export * as PluginRuntimeProvider from "./runtime-provider.js"

import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Agent } from "../agent.js"
import { Job } from "../job.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"
import { Mcp } from "../mcp/index.js"
import { PersistentPty } from "../persistent-pty.js"
import { Session } from "../session.js"
import { PluginRuntime } from "./runtime.js"

// Application wiring stays outside the facade so Plugin can be imported by Session.
export const configured = (cell: PluginRuntime.Cell) =>
  makeGlobalNode({
    name: "plugin-runtime-provider",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const jobs = yield* Job.Service
        const locations = yield* LocationServiceMap.Service
        const persistentPty = yield* PersistentPty.Service
        const runtime: PluginRuntime.Interface = {
          session: sessions,
          job: jobs,
          persistentPty,
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
    ),
    deps: [PluginRuntime.node, Session.node, Job.node, LocationServiceMap.node, PersistentPty.node],
  })

export const node = configured(PluginRuntime.defaultCell)
