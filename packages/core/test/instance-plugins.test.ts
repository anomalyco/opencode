import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, LayerMap } from "effect"
import { Plugin } from "@opencode-ai/plugin/effect"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Instance } from "@opencode-ai/core/instance"
import { Entry, fromMap } from "@opencode-ai/core/instance-map/internal"
import { InstancePlugins } from "@opencode-ai/core/plugin/instance"
import { InstanceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"

const agentPlugin = (pluginID: string, agentID: string) =>
  Plugin.define({
    id: pluginID,
    effect: (ctx) => ctx.agent.transform((agents) => agents.update(Agent.ID.make(agentID), () => {})),
  })

// The retained location selects construction options without interpreting the key.
const instances = Layer.effect(
  InstanceMap.Service,
  Effect.map(
    LayerMap.make(
      (entry: Entry) => {
        const ref = entry.location
        return Instance.layer(ref, {
          plugins:
            path.basename(ref.directory) === "thread-a" ? [agentPlugin("thread-a-plugin", "thread-a-agent")] : [],
          replacements: [[Global.node, tempGlobalLayer]],
        })
      },
      { idleTimeToLive: Duration.infinity },
    ),
    fromMap,
  ),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, InstanceMap.node]), [
    [Global.node, tempGlobalLayer],
    [InstanceMap.node, instances],
  ]),
)

describe("InstancePlugins", () => {
  it.live("binds plugins to one instance without leaking to siblings", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const locations = yield* InstanceMap.Service
          const sdk = yield* SdkPlugins.Service
          yield* sdk.register(agentPlugin("global-plugin", "global-agent"))

          const dirA = path.join(dir.path, "thread-a")
          const dirB = path.join(dir.path, "thread-b")
          yield* Effect.promise(() => fs.mkdir(dirA))
          yield* Effect.promise(() => fs.mkdir(dirB))
          const refA = Location.Ref.make({ directory: AbsolutePath.make(dirA) })
          const refB = Location.Ref.make({ directory: AbsolutePath.make(dirB) })

          const agents = (ref: Location.Ref) =>
            Effect.gen(function* () {
              const supervisor = yield* PluginSupervisor.Service
              yield* supervisor.flush
              const service = yield* Agent.Service
              return {
                bound: yield* service.get(Agent.ID.make("thread-a-agent")),
                global: yield* service.get(Agent.ID.make("global-agent")),
              }
            }).pipe(Effect.scoped, Effect.provide(locations.get(ref)))

          const a = yield* agents(refA)
          expect(a.bound).toBeDefined()
          expect(a.global).toBeDefined()

          const b = yield* agents(refB)
          expect(b.bound).toBeUndefined()
          expect(b.global).toBeDefined()

          // Eviction and rebuild re-bind the same list.
          yield* locations.invalidate(refA)
          const rebuilt = yield* agents(refA)
          expect(rebuilt.bound).toBeDefined()
          expect(rebuilt.global).toBeDefined()
        }),
      ),
    ),
  )
})

describe("InstancePlugins.bound", () => {
  test("rejects duplicate ids in one list", () => {
    const plugin = Plugin.define({ id: "dup", effect: () => Effect.void })
    expect(() => InstancePlugins.bound([plugin, plugin])).toThrow("duplicate instance plugin ids: dup")
  })
})
