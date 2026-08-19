export * as HotReload from "./hot-reload"

// Hot reload (experimental): when config-relevant files change on disk,
// reload the instance so skills, agents, commands and config pick up the
// change without restarting opencode. InstanceStore arms this after each
// boot and passes its own reload effect in, so clients get the existing
// server.instance.disposed event and re-sync. The listener lives at the
// layer, not in instance state, so a reload that fails to boot (for example
// an invalid config edit) stays armed and retries when the file is fixed.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Context, Effect, Layer, Scope } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { invalidateLocationDirectory } from "@opencode-ai/core/location-services"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Skill } from "@/skill"

const DEBOUNCE_MS = 200

// Config directories also hold runtime output (plans, plugin installs), so
// only these child directories are treated as config content.
const CONFIG_SEGMENTS = new Set([
  "agent",
  "agents",
  "command",
  "commands",
  "mode",
  "modes",
  "plugin",
  "plugins",
  "skill",
  "skills",
  "theme",
  "themes",
  "tool",
  "tools",
])

export type Roots = {
  configDirs: readonly string[]
  skillDirs: readonly string[]
  /** Exact config file paths, e.g. <worktree>/opencode.json. */
  documents: ReadonlySet<string>
}

function inside(root: string, file: string) {
  const relative = path.relative(root, file)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function relevant(file: string, roots: Roots) {
  if (roots.documents.has(file)) return true
  if (roots.skillDirs.some((dir) => inside(dir, file))) return true
  return roots.configDirs.some((dir) => {
    if (!inside(dir, file)) return false
    const segment = path.relative(dir, file).split(path.sep)[0]
    return CONFIG_SEGMENTS.has(segment)
  })
}

export interface Interface {
  readonly init: (reload: Effect.Effect<void>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HotReload") {}

type Entry = {
  roots: Roots
  reload: Effect.Effect<void>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const skill = yield* Skill.Service
    const scope = yield* Scope.Scope
    const entries = new Map<string, Entry>()
    // Kept apart from entries: init replaces the entry on every boot, and a
    // reload in flight must not lose its pending marker to that swap.
    const pendings = new Set<string>()

    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== Watcher.Event.Updated.type) return Effect.void
      const directory = event.location?.directory
      const entry = directory === undefined ? undefined : entries.get(directory)
      if (!directory || !entry || pendings.has(directory)) return Effect.void
      const data = event.data as EventV2.Data<typeof Watcher.Event.Updated>
      if (!relevant(data.file, entry.roots)) return Effect.void
      pendings.add(directory)
      return Effect.gen(function* () {
        yield* Effect.sleep(DEBOUNCE_MS)
        yield* Effect.logInfo("hot reload", { directory, file: data.file })
        // Drop cached v2 location layers so the rebuilt instance reads fresh
        // state everywhere, then reload through InstanceStore.
        yield* invalidateLocationDirectory(directory)
        yield* entry.reload
      }).pipe(
        Effect.ensuring(Effect.sync(() => pendings.delete(directory))),
        Effect.catchCause((cause) => Effect.logError("hot reload failed", { directory, cause })),
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    })
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({
      init: Effect.fn("HotReload.init")(function* (reload) {
        if (!flags.experimentalHotReload) return
        const ctx = yield* InstanceState.context
        const configDirs = yield* config.directories()
        const documents = new Set(
          [...configDirs, ctx.worktree, ctx.directory].flatMap((dir) => [
            path.join(dir, "opencode.json"),
            path.join(dir, "opencode.jsonc"),
          ]),
        )
        entries.set(ctx.directory, {
          roots: { configDirs, skillDirs: yield* skill.dirs(), documents },
          reload,
        })
      }),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, EventV2Bridge.node, RuntimeFlags.node, Skill.node],
})
