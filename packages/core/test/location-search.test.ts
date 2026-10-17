import { describe, expect, spyOn } from "bun:test"
import { FileFinder } from "@ff-labs/fff-bun"
import { Effect, Exit, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { location } from "./fixture/location"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

// Records every fff engine that is created and not yet destroyed, keyed by its base path.
function trackEngines() {
  const live = new Map<object, string>()
  const create = FileFinder.create.bind(FileFinder)
  const spy = spyOn(FileFinder, "create").mockImplementation((options) => {
    const result = create(options)
    if (!result.ok) return result
    const destroy = result.value.destroy.bind(result.value)
    live.set(result.value, options.basePath)
    result.value.destroy = () => {
      live.delete(result.value)
      destroy()
    }
    return result
  })
  return { spy, live: (directory: string) => Array.from(live.values()).filter((item) => item === directory).length }
}

describe("location search engines", () => {
  it.live(
    "keeps one fff engine per directory while a reload waits on a borrowed graph",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!FileFinder.isAvailable()) return
          const dir = yield* tmpdirScoped("opencode-fff-reload-")
          expect(Bun.spawnSync(["git", "init", "-q"], { cwd: dir.path }).exitCode).toBe(0)
          const engines = trackEngines()
          yield* Effect.addFinalizer(() => Effect.sync(() => engines.spy.mockRestore()))

          const locations = yield* LocationServiceMap.Service
          const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          // A running session keeps borrowing its graph while a reload replaces it.
          const borrowed = yield* locations.contextEffect(ref)
          expect(engines.live(dir.path)).toBe(1)

          yield* LocationServiceMap.reload()
          const replacement = yield* locations.contextEffect(ref)
          expect(replacement).not.toBe(borrowed)

          expect(engines.live(dir.path)).toBe(1)
        }),
      ),
    30_000,
  )

  it.live(
    "destroys the shared fff engine when its last user closes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!FileFinder.isAvailable()) return
          const dir = yield* tmpdirScoped("opencode-fff-release-")
          expect(Bun.spawnSync(["git", "init", "-q"], { cwd: dir.path }).exitCode).toBe(0)
          const engines = trackEngines()
          yield* Effect.addFinalizer(() => Effect.sync(() => engines.spy.mockRestore()))

          const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const layer = FileSystemSearch.fffLayer.pipe(
            Layer.provide(Layer.succeed(Location.Service, Location.Service.of(location(ref)))),
          )
          const first = yield* Scope.make()
          const second = yield* Scope.make()
          yield* Layer.buildWithScope(layer, first)
          yield* Layer.buildWithScope(layer, second)
          expect(engines.live(dir.path)).toBe(1)

          yield* Scope.close(first, Exit.void)
          expect(engines.live(dir.path)).toBe(1)
          yield* Scope.close(second, Exit.void)
          expect(engines.live(dir.path)).toBe(0)
        }),
      ),
    30_000,
  )
})
