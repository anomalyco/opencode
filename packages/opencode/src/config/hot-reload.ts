// Hot reload (experimental): when config-relevant files change on disk,
// reload the instance so skills, agents, commands and config pick up the
// change without restarting opencode. InstanceStore arms this after each
// boot and passes its own reload effect in, so clients get the existing
// server.instance.disposed event and re-sync.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Context, Effect, Layer } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Skill } from "@/skill"

const DEBOUNCE_MS = 200

// Plugin installs write these into config directories on bootstrap; reacting
// to them would reload in a loop.
const IGNORED_FILES = new Set(["package.json", "bun.lock", "bun.lockb", "package-lock.json"])

export function relevant(file: string, roots: readonly string[]) {
  const base = path.basename(file)
  if (IGNORED_FILES.has(base)) return false
  if (base === "opencode.json" || base === "opencode.jsonc") return true
  return roots.some((root) => {
    const relative = path.relative(root, file)
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  })
}

export interface Interface {
  readonly init: (reload: Effect.Effect<unknown>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HotReload") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const locations = yield* LocationServiceMap.Service
    const skill = yield* Skill.Service
    const reloads = new Map<string, Effect.Effect<unknown>>()

    const state = yield* InstanceState.make(
      Effect.fn("HotReload.state")(function* (ctx) {
        const value = { pending: false }
        if (!flags.experimentalHotReload) return value

        const roots = [...(yield* config.directories()), ...(yield* skill.dirs())]
        // The reload runs outside the listener fiber; capture this context so
        // it still sees the instance services.
        const runFork = Effect.runForkWith(yield* Effect.context<never>())

        const reload = Effect.gen(function* () {
          yield* Effect.sleep(DEBOUNCE_MS)
          yield* Effect.logInfo("hot reload", { directory: ctx.directory })
          // v2 location services cache config and skills per location; drop
          // them so the rebuilt instance reads fresh state everywhere.
          yield* locations.invalidate(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))
          // InstanceStore.reload re-runs bootstrap, which re-arms this
          // watcher with freshly discovered directories.
          yield* reloads.get(ctx.directory) ?? Effect.void
        }).pipe(
          Effect.catchCause((cause) => Effect.logError("hot reload failed", { directory: ctx.directory, cause })),
        )

        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Watcher.Event.Updated.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventV2.Data<typeof Watcher.Event.Updated>
          if (!relevant(data.file, roots)) return Effect.void
          return Effect.sync(() => {
            if (value.pending) return
            value.pending = true
            runFork(reload)
          })
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        return value
      }),
    )

    return Service.of({
      init: Effect.fn("HotReload.init")(function* (reload) {
        const ctx = yield* InstanceState.context
        reloads.set(ctx.directory, reload)
        yield* InstanceState.get(state)
      }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, EventV2Bridge.node, RuntimeFlags.node, Skill.node, locationServiceMapNode],
})

export * as HotReload from "./hot-reload"
