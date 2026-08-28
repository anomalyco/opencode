export * as ProjectMarkers from "./markers.js"

import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Option } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import path from "path"
import { fileURLToPath } from "url"
import type { ConfigPluginSource } from "../config/plugin/source.js"
import type { Versioned } from "../plugin.js"
import { PluginModule } from "../plugin/module.js"
import { PluginSourceDirectory } from "../plugin/source-directory.js"
import { SdkPlugins } from "../plugin/sdk.js"
import { AbsolutePath } from "../schema.js"

export interface Match {
  readonly type: string
  readonly directory: AbsolutePath
  readonly marker: AbsolutePath
}

export interface Interface {
  readonly discover: (
    directory: AbsolutePath,
    options?: { readonly discovery?: boolean },
  ) => Effect.Effect<Match | undefined>
  readonly targets: () => readonly string[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectMarkers") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const npm = yield* Npm.Service
    const sdk = yield* SdkPlugins.Service
    const known = new Set([".git", ".hg"])
    const loaded = new Map<string, Versioned | undefined>()

    // The filesystem half of discovery: walk up for config, scan plugin
    // directories, and read configured plugin operations. This is the part a
    // no-discovery caller must skip — it imports plugin modules.
    const scanOperations = Effect.fnUntraced(function* (directory: AbsolutePath) {
      const found = yield* fs
        .up({ targets: [".opencode", "opencode.json", "opencode.jsonc"], start: directory })
        .pipe(Effect.orElseSucceed(() => []))
      const roots = [global.config, ...found.filter((value) => path.basename(value) === ".opencode").toReversed()]
      const files = [
        ...["opencode.json", "opencode.jsonc"].map((name) => path.join(global.config, name)),
        ...found.filter((value) => path.basename(value) !== ".opencode").toReversed(),
        ...roots.slice(1).flatMap((root) => ["opencode.json", "opencode.jsonc"].map((name) => path.join(root, name))),
      ]
      const automatic = yield* Effect.forEach(roots, (root) => PluginSourceDirectory.discover(fs, root)).pipe(
        Effect.map((entries) => entries.flat()),
      )
      const configured = yield* Effect.forEach([...new Set(files)], (file) => read(fs, file)).pipe(
        Effect.map((entries) => entries.flat()),
      )
      return yield* Effect.forEach(
        [
          ...automatic.map((target): ConfigPluginSource.Operation => ({ type: "add", target, options: {} })),
          ...configured,
        ],
        (operation) => {
          if (operation.type === "remove" || !path.isAbsolute(operation.target)) return Effect.succeed(operation)
          return fs.stat(operation.target).pipe(
            Effect.map((info) => ({
              ...operation,
              mtime: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
            })),
            Effect.orElseSucceed(() => operation),
          )
        },
      )
    })

    const discover = Effect.fn("ProjectMarkers.discover")(function* (
      directory: AbsolutePath,
      options?: { readonly discovery?: boolean },
    ) {
      // discovery: false skips the config scan and its plugin module loading;
      // sdk-declared vcs markers are host-explicit, not ambient, so they stay.
      const operations = options?.discovery === false ? [] : yield* scanOperations(directory)
      const declarations = new Map<string, { readonly id: string; readonly markers: readonly string[] }>()

      for (const plugin of sdk.all()) {
        if (!plugin.vcs) continue
        declarations.set(plugin.id, { id: plugin.vcs.id ?? plugin.id, markers: plugin.vcs.markers })
      }

      for (const operation of operations) {
        if (operation.type === "remove") {
          for (const id of declarations.keys()) {
            if (
              operation.target === "*" ||
              (operation.target.endsWith(".*") ? id.startsWith(operation.target.slice(0, -1)) : operation.target === id)
            ) {
              declarations.delete(id)
            }
          }
          continue
        }
        if (operation.target === "*" || operation.target.endsWith(".*") || operation.target.startsWith("opencode."))
          continue
        const key = JSON.stringify(operation)
        const plugin = loaded.has(key)
          ? loaded.get(key)
          : yield* PluginModule.load(operation).pipe(
              Effect.provideService(Npm.Service, npm),
              Effect.catchCause((cause) =>
                Effect.logDebug("failed to discover plugin repository markers", {
                  target: operation.target,
                  cause,
                }).pipe(Effect.as(undefined)),
              ),
              Effect.tap((value) => Effect.sync(() => loaded.set(key, value))),
            )
        if (!plugin?.vcs) continue
        declarations.set(plugin.id, { id: plugin.vcs.id ?? plugin.id, markers: plugin.vcs.markers })
      }

      const markers = new Map<string, string>()
      for (const declaration of declarations.values()) {
        if (!/^[a-z][a-z0-9._-]*$/.test(declaration.id)) continue
        for (const marker of declaration.markers) {
          if (!marker || marker === "." || marker === ".." || /[\\/]/.test(marker)) continue
          known.add(marker)
          markers.set(marker, declaration.id)
        }
      }
      if (!markers.size) return undefined

      const marker = yield* fs.up({ targets: [...markers.keys()], start: directory, mode: "first" }).pipe(
        Effect.map((entries) => entries[0]),
        Effect.orElseSucceed(() => undefined),
      )
      if (!marker) return undefined
      const type = markers.get(path.basename(marker))
      if (!type) return undefined
      return {
        type,
        directory: AbsolutePath.make(path.dirname(marker)),
        marker: AbsolutePath.make(marker),
      } satisfies Match
    })

    return Service.of({ discover, targets: () => [...known] })
  }),
)

function read(fs: FSUtil.Interface, file: string): Effect.Effect<ConfigPluginSource.Operation[]> {
  return Effect.gen(function* () {
    const source = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
    if (!source) return []
    const errors: ParseError[] = []
    const document: unknown = parse(source, errors, { allowTrailingComma: true })
    if (errors.length || typeof document !== "object" || document === null || !("plugins" in document)) return []
    if (!Array.isArray(document.plugins)) return []
    return document.plugins.flatMap<ConfigPluginSource.Operation>((entry) => {
      if (typeof entry === "string" && entry.startsWith("-")) {
        return [{ type: "remove", target: entry.slice(1) }]
      }
      if (
        typeof entry !== "string" &&
        (typeof entry !== "object" || entry === null || !("package" in entry) || typeof entry.package !== "string")
      ) {
        return []
      }
      const target = typeof entry === "string" ? entry : entry.package
      const options =
        typeof entry !== "string" && "options" in entry && typeof entry.options === "object" && entry.options !== null
          ? Object.fromEntries(Object.entries(entry.options))
          : {}
      if (target.startsWith("file://")) return [{ type: "add", target: fileURLToPath(target), options }]
      if (target.startsWith("./") || target.startsWith("../")) {
        return [{ type: "add", target: path.resolve(path.dirname(file), target), options }]
      }
      return [{ type: "add", target, options }]
    })
  })
}

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Npm.node, SdkPlugins.node],
})
