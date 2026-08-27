export * as PluginDiscovery from "./discovery.js"

import { Directory, Document, type Entry } from "@opencode-ai/schema/config"
import { ConfigPlugin } from "@opencode-ai/schema/config/plugin"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Cause, Context, Effect, Layer, Option, Schema } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import path from "path"
import { fileURLToPath } from "url"
import { Plugin } from "../plugin.js"
import { AbsolutePath } from "../schema.js"
import { PluginModule } from "./module.js"
import { PluginSourceDirectory } from "./source-directory.js"

export type Operation =
  | {
      readonly type: "add"
      readonly target: string
      readonly options: Record<string, unknown>
      readonly mtime?: number
    }
  | {
      readonly type: "remove"
      readonly target: string
    }

export interface Interface {
  readonly operations: (directory: AbsolutePath, entries?: readonly Entry[]) => Effect.Effect<readonly Operation[]>
  readonly resolve: (
    pre: readonly Plugin.Versioned[],
    post: readonly Plugin.Versioned[],
    operations: readonly Operation[],
  ) => Effect.Effect<{
    readonly plugins: readonly Plugin.Versioned[]
    readonly failures: readonly Extract<Plugin.Info, { readonly status: "failed" }>[]
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginDiscovery") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const npm = yield* Npm.Service
    const loaded = new Map<string, Plugin.Versioned | { readonly error: string }>()

    const operations = Effect.fn("PluginDiscovery.operations")(function* (
      directory: AbsolutePath,
      entries?: readonly Entry[],
    ) {
      const found = entries
        ? undefined
        : yield* fs
            .up({ targets: [".opencode", "opencode.json", "opencode.jsonc"], start: directory })
            .pipe(Effect.orElseSucceed(() => []))
      const roots = entries
        ? entries.filter((entry): entry is Directory => entry.type === "directory").map((entry) => entry.path)
        : [global.config, ...(found ?? []).filter((value) => path.basename(value) === ".opencode").toReversed()]
      const files = entries
        ? undefined
        : [
            ...["opencode.json", "opencode.jsonc"].map((name) => path.join(global.config, name)),
            ...(found ?? []).filter((value) => path.basename(value) !== ".opencode").toReversed(),
            ...roots
              .slice(1)
              .flatMap((root) => ["opencode.json", "opencode.jsonc"].map((name) => path.join(root, name))),
          ]
      const discovered = yield* Effect.forEach(roots, (root) => PluginSourceDirectory.discover(fs, root)).pipe(
        Effect.map((groups) => groups.flat().map((target): Operation => ({ type: "add", target, options: {} }))),
      )
      const configured = entries
        ? entries
            .filter((entry): entry is Document => entry.type === "document")
            .flatMap((entry) =>
              (entry.info.plugins ?? []).map((plugin) =>
                operation(plugin, entry.path ? path.dirname(entry.path) : directory),
              ),
            )
        : yield* Effect.forEach([...new Set(files)], (file) =>
            Effect.gen(function* () {
              const source = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
              if (!source) return []
              const errors: ParseError[] = []
              const document: unknown = parse(source, errors, { allowTrailingComma: true })
              if (errors.length || typeof document !== "object" || document === null || !("plugins" in document))
                return []
              const plugins = Schema.decodeUnknownOption(ConfigPlugin.Plugins)(document.plugins)
              if (Option.isNone(plugins)) return []
              return plugins.value.map((plugin) => operation(plugin, path.dirname(file)))
            }),
          ).pipe(Effect.map((groups) => groups.flat()))

      return yield* Effect.forEach([...discovered, ...configured], (item) => {
        if (item.type === "remove" || !path.isAbsolute(item.target)) return Effect.succeed(item)
        return fs.stat(item.target).pipe(
          Effect.map((info) => ({ ...item, mtime: Option.getOrElse(info.mtime, () => new Date(0)).getTime() })),
          Effect.orElseSucceed(() => item),
        )
      })
    })

    const resolve = Effect.fn("PluginDiscovery.resolve")(function* (
      pre: readonly Plugin.Versioned[],
      post: readonly Plugin.Versioned[],
      operations: readonly Operation[],
    ) {
      const matches = (selector: string, target: string) =>
        selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
      const definitions = [...pre, ...post]
      const enabled = new Set(definitions.map((plugin) => plugin.id))
      const packages = new Map<string, Plugin.Versioned>()
      const failures = new Map<string, Extract<Plugin.Info, { readonly status: "failed" }>>()

      for (const item of operations) {
        const plugins = [...definitions, ...packages.values()]
        if (item.type === "remove") {
          if (item.target === "*") failures.clear()
          plugins.filter((plugin) => matches(item.target, plugin.id)).forEach((plugin) => enabled.delete(plugin.id))
          continue
        }

        const matched = plugins.filter((plugin) => matches(item.target, plugin.id))
        if (
          matched.length > 0 ||
          item.target === "*" ||
          item.target.endsWith(".*") ||
          item.target.startsWith("opencode.")
        ) {
          matched.forEach((plugin) => enabled.add(plugin.id))
          continue
        }

        const key = JSON.stringify(item)
        const plugin = loaded.has(key)
          ? loaded.get(key)
          : yield* PluginModule.load(item).pipe(
              Effect.provideService(Npm.Service, npm),
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to load plugin", { target: item.target, cause }).pipe(
                  Effect.as({ error: Cause.pretty(cause) }),
                ),
              ),
              Effect.tap((value) => Effect.sync(() => loaded.set(key, value))),
            )
        if (!plugin) continue
        if ("error" in plugin) {
          failures.set(item.target, {
            source: path.isAbsolute(item.target)
              ? { type: "local", path: item.target }
              : { type: "package", package: item.target },
            status: "failed",
            error: plugin.error,
            tui: false,
          })
          continue
        }
        failures.delete(item.target)
        const previous = packages.get(item.target)
        if (previous) enabled.delete(previous.id)
        packages.set(item.target, plugin)
        enabled.add(plugin.id)
      }

      return {
        plugins: [
          ...pre.filter((plugin) => enabled.has(plugin.id)),
          ...[...packages.values()].filter((plugin) => enabled.has(plugin.id)),
          ...post.filter((plugin) => enabled.has(plugin.id)),
        ],
        failures: [...failures.values()],
      }
    })

    return Service.of({ operations, resolve })
  }),
)

function operation(input: ConfigPlugin.Plugin, directory: string): Operation {
  if (typeof input === "string" && input.startsWith("-")) {
    if (input.length === 1) throw new Error("Plugin remove operation requires a target")
    return { type: "remove", target: input.slice(1) }
  }
  const target = typeof input === "string" ? input : input.package
  const options = typeof input === "string" ? {} : (input.options ?? {})
  if (target.startsWith("file://")) return { type: "add", target: fileURLToPath(target), options }
  if (target.startsWith("./") || target.startsWith("../")) {
    return { type: "add", target: path.resolve(directory, target), options }
  }
  return { type: "add", target, options }
}

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Npm.node],
})
