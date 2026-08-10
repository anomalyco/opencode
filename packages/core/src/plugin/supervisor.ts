export * as PluginSupervisor from "./supervisor"

import type { Plugin as PluginDefinition } from "@opencode-ai/plugin/effect/plugin"
import { Event } from "@opencode-ai/schema/config"
import { Context, Deferred, Effect, Layer, Schema, Stream } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "../agent"
import { Catalog } from "../catalog"
import { Command } from "../command"
import { ConfigPluginSource } from "../config/plugin/source"
import { Credential } from "../credential"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { Bus } from "../bus"
import { Environment } from "../environment"
import { FileMutation } from "../file-mutation"
import { Formatter } from "../formatter"
import { FileSystem } from "../filesystem"
import { Form } from "../form"
import { Global } from "@opencode-ai/util/global"
import { Image } from "../image"
import { Integration } from "../integration"
import { KV } from "../kv"
import { LocationMutation } from "../location-mutation"
import { ModelsDev } from "../models-dev"
import { Npm } from "@opencode-ai/util/npm"
import { Permission } from "../permission"
import { Plugin } from "../plugin"
import { PluginPromise } from "../plugin/promise"
import { Reference } from "../reference"
import { Ripgrep } from "../ripgrep"
import { SessionInstructions } from "../session/instructions"
import { Shell } from "../shell"
import { Skill } from "../skill"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { Tool } from "../tool"
import { WebSearch } from "../websearch"
import { WellKnown } from "../wellknown"
import { PluginInternal } from "./internal"
import { PluginRuntime } from "./runtime"
import { SdkPlugins } from "./sdk"
import { importModule } from "@opencode-ai/util/runtime-import"

const PluginModule = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      effect: Schema.declare<PluginDefinition["effect"]>(
        (input): input is PluginDefinition["effect"] => typeof input === "function",
      ),
    }),
    Schema.Struct({
      id: Schema.String,
      setup: Schema.declare<Parameters<typeof PluginPromise.fromPromise>[0]["setup"]>(
        (input): input is Parameters<typeof PluginPromise.fromPromise>[0]["setup"] => typeof input === "function",
      ),
    }),
  ]),
})

const resolve = Effect.fn("PluginSupervisor.resolve")(function* (
  pre: readonly Plugin.Versioned[],
  post: readonly Plugin.Versioned[],
  operations: readonly ConfigPluginSource.Operation[],
) {
  const matches = (selector: string, target: string) =>
    selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
  const definitions = [...pre, ...post]
  const enabled = new Set(definitions.map((plugin) => plugin.id))
  const packages = new Map<string, Plugin.Versioned>()
  const plugins = () => [...definitions, ...packages.values()]

  for (const operation of operations) {
    if (operation.type === "remove") {
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

    const plugin = yield* load(operation).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to load plugin", { target: operation.target, cause }).pipe(Effect.as(undefined)),
      ),
    )
    if (!plugin) continue
    const previous = packages.get(operation.target)
    if (previous) enabled.delete(previous.id)
    packages.set(operation.target, plugin)
    enabled.add(plugin.id)
  }

  return [
    ...pre.filter((plugin) => enabled.has(plugin.id)),
    ...Array.from(packages.values()).filter((plugin) => enabled.has(plugin.id)),
    ...post.filter((plugin) => enabled.has(plugin.id)),
  ]
})

const load = Effect.fn("PluginSupervisor.load")(function* (
  operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
) {
  const npm = yield* Npm.Service
  const entrypoint = path.isAbsolute(operation.target)
    ? pathToFileURL(operation.target).href
    : (yield* npm.add(operation.target, { subpaths: ["server", ""] })).entrypoint
  if (!entrypoint) return
  // Bun currently ignores query parameters when caching file:// imports.
  const source =
    operation.mtime === undefined
      ? entrypoint
      : typeof Bun !== "undefined"
        ? `${operation.target.replaceAll("\\", "/")}?mtime=${operation.mtime}`
        : `${entrypoint}?mtime=${operation.mtime}`
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: source })
  const mod = yield* Effect.promise(() => importModule(source))
  const value = (yield* Schema.decodeUnknownEffect(PluginModule)(mod)).default
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  return {
    id: plugin.id,
    version: JSON.stringify(operation),
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Plugin.Versioned
})

export interface Interface {
  /** Wait for the initial plugin generation and startup updates to settle. */
  readonly flush: Effect.Effect<void>
}

export const Options = Schema.Struct({
  /** Set false to activate only precompiled (internal and SDK) plugins, skipping config-declared
   * packages and plugin directories entirely: no filesystem scan, npm install, or disk import. */
  dynamic: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}

const makeLayer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const registry = yield* Plugin.Service
      const sdk = yield* SdkPlugins.Service
      const sources = yield* ConfigPluginSource.Service
      const bus = yield* Bus.Service
      const ready = { current: yield* Deferred.make<void>() }
      let observed = 0

      const activate = Effect.fn("PluginSupervisor.activate")(function* () {
        // Resolve OpenCode's internal plugins with their privileged Location services.
        const internal = yield* PluginInternal.list()
        // Combine internal plugins with host-contributed SDK plugins in boot order.
        const pre = [...internal.pre.map((plugin) => ({ ...plugin, version: "internal" })), ...sdk.all()]
        const post = internal.post.map((plugin) => ({ ...plugin, version: "internal" }))
        const operations = yield* sources.operations()
        // Apply config operations and load enabled package plugins into one ordered generation.
        const plugins = yield* resolve(pre, post, operations)
        // Replace the active generation in one scoped, batched activation.
        yield* registry.activate(plugins)
      })
      const updates = Stream.merge(sources.changes(), bus.subscribe([Event.Updated, SdkPlugins.Updated])).pipe(
        // Make accepted work visible to flush before coalescing the burst.
        Stream.mapEffect(() =>
          Effect.gen(function* () {
            observed++
            if (yield* Deferred.isDone(ready.current)) ready.current = yield* Deferred.make<void>()
            return observed
          }),
        ),
      )
      yield* Stream.concat(Stream.succeed(0), updates).pipe(
        // Keep observing updates while activation runs, retaining only the latest generation request.
        Stream.buffer({ capacity: 1, strategy: "sliding" }),
        Stream.debounce("100 millis"),
        Stream.runForEach((target) =>
          Effect.gen(function* () {
            yield* activate()
            if (observed === target) yield* Deferred.succeed(ready.current, undefined)
          }).pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      return Service.of({ flush: Effect.suspend(() => Deferred.await(ready.current)) })
    }),
  ).pipe(Layer.provide(ConfigPluginSource.layer(options)))

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: makeLayer(options),
    deps: nodeDeps,
  })
}

const nodeDeps = [
  Plugin.node,
  SdkPlugins.node,
  Agent.node,
  Catalog.node,
  Command.node,
  ConfigPluginSource.requirements,
  Credential.node,
  Bus.node,
  Environment.node,
  FileMutation.node,
  Formatter.node,
  FileSystem.node,
  Global.node,
  httpClient,
  Image.node,
  Integration.node,
  KV.node,
  LocationMutation.node,
  ModelsDev.node,
  Npm.node,
  Permission.node,
  PluginRuntime.node,
  Form.node,
  ReadToolFileSystem.node,
  Reference.node,
  Ripgrep.node,
  SessionInstructions.node,
  Shell.node,
  Skill.node,
  Tool.node,
  WebSearch.node,
  WellKnown.node,
] as const

export const node = configured()

export const layer = makeLayer()
