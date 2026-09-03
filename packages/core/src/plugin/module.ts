export * as PluginModule from "./module.js"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Host } from "@opencode-ai/plugin/host"
import { Npm } from "@opencode-ai/util/npm"
import { Effect, Schema } from "effect"
import path from "path"
import { stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import type { ConfigPluginSource } from "../config/plugin/source.js"
import type { Generation } from "../plugin.js"
import { PluginPromise } from "./promise.js"

const Module = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      effect: Schema.declare<Plugin["effect"]>((input): input is Plugin["effect"] => typeof input === "function"),
    }),
    Schema.Struct({
      id: Schema.String,
      setup: Schema.declare<Parameters<typeof PluginPromise.fromPromise>[0]["setup"]>(
        (input): input is Parameters<typeof PluginPromise.fromPromise>[0]["setup"] => typeof input === "function",
      ),
    }),
  ]),
})

export class LoadError extends Schema.TaggedError<LoadError>()("PluginModule.LoadError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const load = Effect.fn("PluginModule.load")(function* (
  operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
  options?: { readonly install?: boolean },
) {
  const local = path.isAbsolute(operation.target)
  const npm = yield* Npm.Service
  const installed = local
    ? undefined
    : options?.install === false
      ? yield* npm.resolve(operation.target)
      : yield* npm.add(operation.target)
  // Legacy auto-discovery still admits standalone server sources. Configured
  // local plugins always arrive here as directories.
  const entrypoints: Host.Entrypoints =
    local && (yield* Effect.promise(() => stat(operation.target))).isFile()
      ? { server: pathToFileURL(operation.target).href }
      : yield* Effect.sync(() => Host.resolve(installed ?? { directory: operation.target }))
  const entrypoint = entrypoints.server
  if (!local && options?.install === false && !entrypoint) return { pending: true as const }
  if (!entrypoint) return yield* new LoadError({ message: `Plugin entrypoint not found: ${operation.target}` })
  // Bun currently ignores query parameters when caching file:// imports.
  const target = typeof Bun !== "undefined" ? fileURLToPath(entrypoint).replaceAll("\\", "/") : entrypoint
  const source = operation.mtime === undefined ? entrypoint : `${target}?mtime=${operation.mtime}`
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: source })
  const mod = yield* Effect.promise(() => Host.load(source))
  const value = (yield* Schema.decodeUnknownEffect(Module)(mod).pipe(
    Effect.mapError(
      (cause) =>
        new LoadError({
          message: "Plugin must export a default definition with an id and an effect or setup function.",
          cause,
        }),
    ),
  )).default
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  return {
    id: plugin.id,
    features: {
      ...(entrypoints.tui ? { tui: true as const } : {}),
      ...(entrypoints.rpc ? { rpc: true as const } : {}),
    },
    revision: JSON.stringify([operation, installed?.revision]),
    source: path.isAbsolute(operation.target)
      ? { type: "local" as const, path: fileURLToPath(entrypoint) }
      : {
          type: "package" as const,
          target: operation.target,
          ...(installed?.version ? { version: installed.version } : {}),
        },
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Generation
})
