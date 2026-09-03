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
import { Plugin } from "@opencode-ai/core/plugin"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { Database } from "../src/database/database"
import { Bus } from "../src/bus"

// Config the host hands the vanilla instance explicitly must survive discovery: false.
const hostConfig: LayerNode.Replacements = [
  Config.node.replace(
    Config.configured({
      project: false,
      global: false,
      content: JSON.stringify({ shell: "vanilla-host" }),
    }),
  ),
]

// Same directory contents, two instances: one vanilla, one with discovery.
const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: Location.Ref) => {
        const name = path.basename(ref.directory)
        return Instance.layer(ref, {
          // "bare" exercises the vanilla defaults themselves: no caller Config.
          discovery: name !== "vanilla" && name !== "bare",
          // Caller replacements win over the vanilla defaults.
          replacements: [...bindings, ...(name === "vanilla" ? hostConfig : [])],
        })
      },
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, {
          provide: (session) => Effect.provide(map.get(session.location)),
        }),
      ),
    ]
    return map
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
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
              const plugins = yield* Plugin.Service
              yield* plugins.awaitActivation
              const config = yield* Config.Service
              const discovery = yield* InstructionDiscovery.Service
              const entries = yield* config.entries()
              return {
                documents: entries.filter(
                  (entry) => "path" in entry && typeof entry.path === "string" && entry.path.startsWith(ref.directory),
                ),
                instructions: yield* discovery.list(),
                shell: Config.latest(entries, "shell"),
              }
            }).pipe(Effect.scoped, Effect.provide(locations.get(ref)))

          const vanilla = yield* read(yield* plant("vanilla"))
          expect(vanilla.documents).toEqual([])
          expect(vanilla.instructions).toEqual([])
          // Host-injected content survives discovery: false.
          expect(vanilla.shell).toBe("vanilla-host")

          // Bare vanilla: the defaults themselves, with no caller Config.
          const bare = yield* read(yield* plant("bare"))
          expect(bare.documents).toEqual([])
          expect(bare.instructions).toEqual([])
          expect(bare.shell).toBeUndefined()

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
