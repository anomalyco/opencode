export * as PluginModule from "./module.js"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Npm } from "@opencode-ai/util/npm"
import { importModule } from "@opencode-ai/util/runtime-import"
import { Effect, Schema } from "effect"
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
      tui: Schema.optional(Schema.Boolean),
      vcs: Schema.optional(Discovery),
      effect: Schema.declare<Plugin["effect"]>((input): input is Plugin["effect"] => typeof input === "function"),
    }),
    Schema.Struct({
      id: Schema.String,
      tui: Schema.optional(Schema.Boolean),
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
  const entrypoint = path.isAbsolute(operation.target)
    ? pathToFileURL(operation.target).href
    : (yield* npm.add(operation.target, { subpaths: ["server", ""] })).entrypoint
  if (!entrypoint) return yield* Effect.fail(new Error(`Plugin entrypoint not found: ${operation.target}`))
  // Bun currently ignores query parameters when caching file:// imports.
  const target = typeof Bun !== "undefined" ? operation.target.replaceAll("\\", "/") : entrypoint
  const source = operation.mtime === undefined ? entrypoint : `${target}?mtime=${operation.mtime}`
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: source })
  const mod = yield* Effect.promise(() => importModule(source))
  const value = (yield* Schema.decodeUnknownEffect(Definition)(mod)).default
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  return {
    id: plugin.id,
    tui: plugin.tui,
    vcs: plugin.vcs,
    version: JSON.stringify(operation),
    source: path.isAbsolute(operation.target)
      ? { type: "local" as const, path: operation.target }
      : { type: "package" as const, package: operation.target },
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Versioned
})
