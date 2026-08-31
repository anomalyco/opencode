export * as PluginModule from "./module.js"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Npm } from "@opencode-ai/util/npm"
import { importModule } from "@opencode-ai/util/runtime-import"
import { Effect, Schema } from "effect"
import { readdir } from "node:fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import type { ConfigPluginSource } from "../config/plugin/source.js"
import type { Versioned } from "../plugin.js"
import { PluginPromise } from "./promise.js"

const Discovery = Schema.Struct({
  id: Schema.optional(Schema.String),
  markers: Schema.Array(Schema.String),
})
const Definition = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      vcs: Schema.optional(Discovery),
      effect: Schema.declare<Plugin["effect"]>((input): input is Plugin["effect"] => typeof input === "function"),
    }),
    Schema.Struct({
      id: Schema.String,
      vcs: Schema.optional(Discovery),
      setup: Schema.declare<Parameters<typeof PluginPromise.fromPromise>[0]["setup"]>(
        (input): input is Parameters<typeof PluginPromise.fromPromise>[0]["setup"] => typeof input === "function",
      ),
    }),
  ]),
})

export const load = Effect.fn("PluginModule.load")(function* (
  operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
) {
  const npm = yield* Npm.Service
  const local = path.isAbsolute(operation.target)
  const installed = local
    ? { entrypoint: pathToFileURL(operation.target).href }
    : yield* npm.add(operation.target, { subpaths: ["server", ""] })
  const entrypoint = installed.entrypoint
  if (!entrypoint) return yield* Effect.fail(new Error(`Plugin entrypoint not found: ${operation.target}`))
  // Bun currently ignores query parameters when caching file:// imports.
  const target = typeof Bun !== "undefined" ? operation.target.replaceAll("\\", "/") : entrypoint
  const source = operation.mtime === undefined ? entrypoint : `${target}?mtime=${operation.mtime}`
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: source })
  const mod = yield* Effect.promise(() => importModule(source))
  const value = (yield* Schema.decodeUnknownEffect(Definition)(mod)).default
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  const features = local
    ? yield* localFeatures(operation.target)
    : yield* Effect.all({
        tui: npm.resolve(operation.target, { subpaths: ["tui"] }),
        rpc: npm.resolve(operation.target, { subpaths: ["rpc"] }),
      }).pipe(
        Effect.map((resolved) => ({
          ...(resolved.tui.entrypoint ? { tui: true as const } : {}),
          ...(resolved.rpc.entrypoint ? { rpc: true as const } : {}),
        })),
      )
  return {
    id: plugin.id,
    features,
    vcs: plugin.vcs,
    version: JSON.stringify(operation),
    source: path.isAbsolute(operation.target)
      ? { type: "local" as const, path: operation.target }
      : { type: "package" as const, package: operation.target },
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Versioned
})

function localFeatures(entrypoint: string) {
  if (!path.basename(entrypoint).startsWith("index.")) return Effect.succeed({})
  return Effect.promise(() => readdir(path.dirname(entrypoint), { withFileTypes: true })).pipe(
    Effect.map((entries) => {
      const names = new Set(entries.filter((entry) => entry.isFile() || entry.isSymbolicLink()).map((entry) => entry.name))
      const has = (name: string) =>
        ["ts", "tsx", "js", "jsx", "mts", "mjs", "cts", "cjs"].some((extension) =>
          names.has(`${name}.${extension}`),
        )
      return {
        ...(has("tui") ? { tui: true as const } : {}),
        ...(has("rpc") ? { rpc: true as const } : {}),
      }
    }),
  )
}
