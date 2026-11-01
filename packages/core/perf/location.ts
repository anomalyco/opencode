// The Location service graph, loaded and kept the way a server keeps one per directory a client opens.
// strobe's script host loads this module once per block and calls its exports (perf/location.bench.ts).
// Everything runs against a temporary home: its own global folders and database, no filesystem
// watchers and no network, so it never touches a live server, database or user configuration.
import fs from "fs/promises"
import { rmSync } from "fs"
import os from "os"
import path from "path"
import { Effect, Layer, Logger, ManagedRuntime, Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Bus } from "../src/bus"
import { Database } from "../src/database/database"
import { Integration } from "../src/integration"
import { Location } from "../src/location"
import { LocationServiceMap } from "../src/location-service-map"
import { ModelsDev } from "../src/models-dev"
import { Model } from "../src/model"
import { Plugin } from "../src/plugin"
import { ModelsDevPlugin } from "../src/plugin/models-dev"
import { SdkPlugins } from "../src/plugin/sdk"
import { Provider } from "../src/provider"
import { AbsolutePath } from "../src/schema"
import { Watcher } from "../src/filesystem/watcher"
import { location } from "../test/fixture/location"
import { providerHost, host, integrationHost } from "../test/plugin/host"

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-location-bench-")))
process.on("exit", () => rmSync(root, { recursive: true, force: true }))

const replacements = [
  Global.node.replace(
    Global.layerWith({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "cache", "bin"),
      log: path.join(root, "data", "log"),
      repos: path.join(root, "data", "repos"),
    }),
  ),
  ModelsDev.node.replace(ModelsDev.configured({ fetch: false })),
  Watcher.node.replace(Watcher.configured({ enabled: false })),
]

const runtime = ManagedRuntime.make(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node, ModelsDev.node]),
    replacements,
  ).pipe(Layer.provide(Logger.layer([]))),
)

const offline = Object.assign(() => Promise.reject(new Error("no network in the location benchmark")), {
  preconnect: () => {},
})

const run = <A, E>(effect: Effect.Effect<A, E, LocationServiceMap.Service | ModelsDev.Service>) =>
  runtime.runPromise(effect.pipe(Effect.provideService(FetchHttpClient.Fetch, offline)))

// The variant's own checkout: a real project with its config, git and instructions.
const ref = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })

export const load = () =>
  run(
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      yield* locations.contextEffect(ref).pipe(Effect.scoped)
    }),
  )

export const invalidate = () =>
  run(
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      yield* locations.invalidate(ref)
    }),
  )

// Graphs and plugin instances stay alive until the process ends, as a long-running server keeps them.
const kept = Effect.runSync(Scope.make())
let made = 0

const population = Effect.gen(function* () {
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  yield* providers.snapshot()
  yield* models.all()
  yield* models.available()
})

// One more full Location graph for a new directory, with its plugins active and its read models
// materialized.
export const keepLocation = () =>
  run(
    Effect.gen(function* () {
      const directory = path.join(root, "projects", `location-${made++}`)
      yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
      const locations = yield* LocationServiceMap.Service
      const context = yield* locations
        .contextEffect(Location.Ref.make({ directory: AbsolutePath.make(directory) }))
        .pipe(Scope.provide(kept))
      const plugins = yield* Plugin.Service.pipe(Effect.provideContext(context))
      yield* plugins.awaitActivation
      yield* population.pipe(Effect.provideContext(context))
    }),
  )

// One more models.dev source plugin against its own Provider, Model and Integration states: the
// shared definitions and per-instance materialization without the rest of a Location graph.
export const keepPlugin = () =>
  run(
    Effect.gen(function* () {
      const modelsDev = yield* ModelsDev.Service
      const directory = AbsolutePath.make(path.join(root, "plugins", `instance-${made++}`))
      const context = yield* Layer.build(
        AppNodeBuilder.build(LayerNode.group([Provider.node, Model.node, Integration.node, Bus.node]), [
          Location.node.replace(
            Layer.succeed(Location.Service, Location.Service.of(location(Location.Ref.make({ directory })))),
          ),
          ...replacements,
        ]),
      ).pipe(Scope.provide(kept))
      const providers = yield* Provider.Service.pipe(Effect.provideContext(context))
      const integration = yield* Integration.Service.pipe(Effect.provideContext(context))
      yield* ModelsDevPlugin.effect(
        host({ provider: providerHost(providers), integration: integrationHost(integration) }),
      ).pipe(Effect.provideService(ModelsDev.Service, modelsDev), Effect.provideContext(context), Scope.provide(kept))
      yield* integration.list()
      yield* population.pipe(Effect.provideContext(context))
    }),
  )
