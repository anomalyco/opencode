import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, LayerMap } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Config } from "@opencode-ai/core/config"
import { Instance } from "@opencode-ai/core/instance"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"

// Same directory contents, two instances: one vanilla, one with discovery.
const instances = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    (ref: Location.Ref) =>
      Instance.layer(ref, {
        discovery: path.basename(ref.directory) !== "vanilla",
        replacements: [[Global.node, tempGlobalLayer]],
      }),
    { idleTimeToLive: Duration.infinity },
  ),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    [Global.node, tempGlobalLayer],
    [LocationServiceMap.node, instances],
  ]),
)

describe("Instance vanilla", () => {
  it.live("boots without filesystem config discovery", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const locations = yield* LocationServiceMap.Service
          const plant = (name: string) =>
            Effect.promise(async () => {
              const directory = path.join(dir.path, name)
              await fs.mkdir(directory)
              await fs.writeFile(path.join(directory, "opencode.json"), "{}")
              await fs.writeFile(path.join(directory, "AGENTS.md"), "planted instructions")
              return Location.Ref.make({ directory: AbsolutePath.make(directory) })
            })

          const read = (ref: Location.Ref) =>
            Effect.gen(function* () {
              const supervisor = yield* PluginSupervisor.Service
              yield* supervisor.flush
              const config = yield* Config.Service
              const discovery = yield* InstructionDiscovery.Service
              const entries = yield* config.entries()
              return {
                documents: entries.filter(
                  (entry) => "path" in entry && typeof entry.path === "string" && entry.path.startsWith(ref.directory),
                ),
                instructions: yield* discovery.list(),
              }
            }).pipe(Effect.scoped, Effect.provide(locations.get(ref)))

          const vanilla = yield* read(yield* plant("vanilla"))
          expect(vanilla.documents).toEqual([])
          expect(vanilla.instructions).toEqual([])

          const discovery = yield* read(yield* plant("discovery"))
          expect(discovery.documents.length).toBeGreaterThan(0)
          expect(
            Array.isArray(discovery.instructions) &&
              discovery.instructions.some((file) => file.path.endsWith("AGENTS.md")),
          ).toBe(true)
        }),
      ),
    ),
  )
})
