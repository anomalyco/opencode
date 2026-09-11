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
import { Flag } from "@opencode-ai/core/flag/flag"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { invalidateLocationDirectory } from "@opencode-ai/core/location-services"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Skill } from "@/skill"

export const DEBOUNCE_MS = 200

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

export type Pending = {
  /** Epoch ms the reload fires at; every further event pushes it out. */
  deadline: number
  /** Most recent relevant file, for the log line. */
  file: string
  running: boolean
  dirty: boolean
}

/**
 * Trailing edge. An edit that lands while the timer counts down pushes the deadline
 * out; one that lands while a reload is in flight marks the entry dirty so the driver
 * loops again. Dropping either would leave the file that triggered the reload
 * unloaded until some later, unrelated edit.
 *
 * Returns the state to drive when this call created it, undefined when a driver for
 * the directory is already running.
 */
export function schedule(pendings: Map<string, Pending>, directory: string, file: string, now: number) {
  const existing = pendings.get(directory)
  if (existing) {
    existing.deadline = now + DEBOUNCE_MS
    existing.file = file
    if (existing.running) existing.dirty = true
    return undefined
  }
  const state: Pending = { deadline: now + DEBOUNCE_MS, file, running: false, dirty: false }
  pendings.set(directory, state)
  return state
}

/**
 * Called once a reload finishes. Returns true when the driver may stop, false when an
 * edit landed mid-reload and the loop has to run again. Stays synchronous so no event
 * can slip in between observing dirty and dropping the entry.
 */
export function settle(pendings: Map<string, Pending>, directory: string) {
  const state = pendings.get(directory)
  if (!state) return true
  state.running = false
  if (state.dirty) return false
  pendings.delete(directory)
  return true
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
    // reload in flight must not lose its pending state to that swap.
    const pendings = new Map<string, Pending>()

    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== Watcher.Event.Updated.type) return Effect.void
      const directory = event.location?.directory
      const entry = directory === undefined ? undefined : entries.get(directory)
      if (!directory || !entry) return Effect.void
      const data = event.data as EventV2.Data<typeof Watcher.Event.Updated>
      if (!relevant(data.file, entry.roots)) return Effect.void

      const state = schedule(pendings, directory, data.file, Date.now())
      if (!state) return Effect.void

      return Effect.gen(function* () {
        while (true) {
          for (let wait = state.deadline - Date.now(); wait > 0; wait = state.deadline - Date.now()) {
            yield* Effect.sleep(wait)
          }
          state.running = true
          state.dirty = false
          yield* Effect.logInfo("hot reload", { directory, file: state.file })
          // Drop cached v2 location layers so the rebuilt instance reads fresh
          // state everywhere, then reload through InstanceStore. Re-read the entry:
          // init replaces it on every boot.
          yield* invalidateLocationDirectory(directory).pipe(
            Effect.andThen(entries.get(directory)?.reload ?? Effect.void),
            Effect.catchCause((cause) => Effect.logError("hot reload failed", { directory, cause })),
          )
          if (settle(pendings, directory)) return
        }
      }).pipe(Effect.forkIn(scope), Effect.asVoid)
    })
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({
      init: Effect.fn("HotReload.init")(function* (reload) {
        if (!flags.experimentalHotReload) return
        const ctx = yield* InstanceState.context
        const configDirs = yield* config.directories()
        // ConfigPaths.files walks opencode.json[c] from the instance directory up to
        // the worktree root, so every level in between is config, not just the ends.
        const documentDirs = new Set<string>([...configDirs, ctx.worktree, ctx.directory])
        for (let dir = ctx.directory; inside(ctx.worktree, dir); dir = path.dirname(dir)) documentDirs.add(dir)
        const documents = new Set(
          [...documentDirs].flatMap((dir) => [path.join(dir, "opencode.json"), path.join(dir, "opencode.jsonc")]),
        )
        // Only fires when the explicit config file happens to sit inside a watched
        // config directory; one outside them still gets no events.
        if (Flag.OPENCODE_CONFIG) documents.add(path.resolve(Flag.OPENCODE_CONFIG))
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
