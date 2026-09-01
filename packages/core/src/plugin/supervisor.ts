export * as PluginSupervisor from "./supervisor.js"

import { Event } from "@opencode-ai/schema/config"
import { Cause, Effect, Layer, Stream } from "effect"
import path from "path"
import { ConfigPluginSource } from "../config/plugin/source.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus.js"
import { Npm } from "@opencode-ai/util/npm"
import { Plugin } from "../plugin.js"
import { InstancePlugins } from "./instance.js"
import { PluginInternal } from "./internal.js"
import { PluginModule } from "./module.js"
import { SdkPlugins } from "./sdk.js"
import { PluginUpdate } from "./update.js"

const resolve = Effect.fn("PluginSupervisor.resolve")(function* (
  pre: readonly Plugin.Generation[],
  post: readonly Plugin.Generation[],
  operations: readonly ConfigPluginSource.Operation[],
  install: boolean,
) {
  const matches = (selector: string, target: string) =>
    selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
  const definitions = [...pre, ...post]
  const enabled = new Set(definitions.map((plugin) => plugin.id))
  const packages = new Map<string, Plugin.Generation>()
  const pending = new Set<string>()
  const failures = new Map<
    string,
    Plugin.Info & { readonly state: Extract<Plugin.State, { readonly status: "failed" }> }
  >()
  const plugins = () => [...definitions, ...packages.values()]

  for (const operation of operations) {
    if (operation.type === "remove") {
      if (operation.target === "*") failures.clear()
      plugins()
        .filter((plugin) => matches(operation.target, plugin.id))
        .forEach((plugin) => enabled.delete(plugin.id))
      continue
    }

    const matched = plugins().filter((plugin) => matches(operation.target, plugin.id))
    const selectsPlugins =
      matched.length > 0 ||
      operation.target === "*" ||
      operation.target.endsWith(".*") ||
      operation.target.startsWith("opencode.")
    if (selectsPlugins) {
      matched.forEach((plugin) => enabled.add(plugin.id))
      continue
    }

    const plugin = yield* PluginModule.load(operation, { install }).pipe(
      Effect.catchCause((cause) => {
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        const error = Cause.squash(cause)
        return Effect.logWarning("failed to load plugin", { target: operation.target, ref, cause }).pipe(
          Effect.as({ error: error instanceof PluginModule.LoadError ? error.message : "Plugin failed to load", ref }),
        )
      }),
    )
    if ("pending" in plugin) {
      pending.add(operation.target)
      continue
    }
    if ("error" in plugin) {
      failures.set(operation.target, {
        source: pluginSource(operation.target),
        state: { status: "failed", error: plugin.error, ref: plugin.ref },
        features: { server: true },
      })
      continue
    }
    failures.delete(operation.target)
    const previous = packages.get(operation.target)
    if (previous) enabled.delete(previous.id)
    packages.set(operation.target, plugin)
    enabled.add(plugin.id)
  }

  return {
    plugins: [
      ...pre.filter((plugin) => enabled.has(plugin.id)),
      ...[...packages.values()].filter((plugin) => enabled.has(plugin.id)),
      ...post.filter((plugin) => enabled.has(plugin.id)),
    ],
    failures: [...failures.values()],
    pending: [...pending],
  }
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* Plugin.Service
    const sdk = yield* SdkPlugins.Service
    const instance = yield* InstancePlugins.Service
    const sources = yield* ConfigPluginSource.Service
    const bus = yield* Bus.Service
    const updates = yield* PluginUpdate.Service
    const internal = yield* PluginInternal.list()
    let release: Effect.Effect<void> | undefined = yield* registry.hold()
    yield* Effect.addFinalizer(() => release ?? Effect.void)
    // Built-ins capture services from this layer; unload them before those services close.
    yield* Effect.addFinalizer(registry.close)
    let packages = new Set<string>()
    let outdated = new Set<string>()
    let generation = 0
    let observed = 0

    const activate = Effect.fn("PluginSupervisor.activate")(function* () {
      const current = ++generation
      // Combine internal plugins with host-contributed plugins in boot order.
      // Instance-bound plugins come last: later activation can override earlier
      // container writes, so the instance's explicit choices win over globals.
      const pre = [
        ...internal.pre.map((plugin) => ({ ...plugin, revision: "internal", source: { type: "builtin" as const } })),
        ...sdk.all(),
        ...instance.all(),
      ]
      const post = internal.post.map((plugin) => ({
        ...plugin,
        revision: "internal",
        source: { type: "builtin" as const },
      }))
      const operations = yield* sources.operations()
      // Activate everything available locally before waiting on missing package installs.
      const immediate = yield* resolve(pre, post, operations, false)
      const source = (source: Plugin.Source) =>
        source.type === "package" && outdated.has(source.target) ? { ...source, outdated: true as const } : source
      const apply = (resolved: typeof immediate) =>
        registry.activate(
          resolved.plugins.map((plugin) => (plugin.source ? { ...plugin, source: source(plugin.source) } : plugin)),
          resolved.failures.map((failure) => ({ ...failure, source: source(failure.source) })),
        )
      yield* apply(immediate)
      const resolved = immediate.pending.length ? yield* resolve(pre, post, operations, true) : immediate
      if (resolved !== immediate) yield* apply(resolved)
      const loaded = new Set(
        [...resolved.plugins, ...resolved.failures].flatMap((plugin) =>
          plugin.source?.type === "package" ? [plugin.source.target] : [],
        ),
      )
      packages = loaded
      yield* Effect.forEach(
        loaded,
        (target) => updates.check(target).pipe(Effect.map((available) => [target, available] as const)),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.flatMap((checked) => {
          if (current !== generation) return Effect.void
          const next = new Set(checked.flatMap(([target, available]) => (available ? [target] : [])))
          if (next.size === outdated.size && [...next].every((target) => outdated.has(target))) return Effect.void
          outdated = next
          return apply(resolved)
        }),
        Effect.forkScoped({ startImmediately: true }),
      )
    })
    const reloads = Stream.merge(
      Stream.merge(sources.changes(), bus.subscribe([Event.Updated, SdkPlugins.Updated])),
      updates.changes().pipe(
        Stream.filter((update) => packages.has(update.target)),
        Stream.tap((update) =>
          Effect.sync(() => (update.outdated ? outdated.add(update.target) : outdated.delete(update.target))),
        ),
        Stream.map(() => undefined),
      ),
    ).pipe(
      // Make accepted work visible to awaitActivation before coalescing the burst.
      Stream.mapEffect(() =>
        Effect.gen(function* () {
          observed++
          if (!release) release = yield* registry.hold()
          return observed
        }),
      ),
    )
    yield* Stream.concat(Stream.succeed(0), reloads).pipe(
      // Keep observing updates while activation runs, retaining only the latest generation request.
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
      Stream.debounce("100 millis"),
      Stream.runForEach((target) =>
        Effect.gen(function* () {
          yield* activate().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause })))
          if (observed !== target) return
          const settled = release
          release = undefined
          if (settled) yield* settled
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Effect.sleep("24 hours").pipe(
      Effect.andThen(
        Effect.acquireUseRelease(
          registry.hold(),
          () => activate(),
          (release) => release,
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    )
  }),
)

const nodeDeps = [
  Plugin.node,
  SdkPlugins.node,
  InstancePlugins.node,
  ConfigPluginSource.node,
  PluginUpdate.node,
  Bus.node,
  Npm.node,
  PluginInternal.requirements,
] as const

function pluginSource(target: string): Plugin.Source {
  if (path.isAbsolute(target)) return { type: "local", path: target }
  return { type: "package", target }
}

export const node = makeLocationNode({ name: "plugin-supervisor", layer, deps: nodeDeps })
