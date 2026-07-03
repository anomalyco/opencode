export * as ConfigExternalPlugin from "./external"

import type { Plugin as EffectPlugin } from "@opencode-ai/plugin/v2/effect"
import type { Plugin as PromisePlugin } from "@opencode-ai/plugin/v2/promise"
import { Effect, Schema } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Config } from "../../config"
import { FSUtil } from "../../fs-util"
import { Location } from "../../location"
import { Npm } from "../../npm"
import { define } from "../../plugin/internal"
import { PluginPromise } from "../../plugin/promise"

const PluginModule = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      effect: Schema.declare<EffectPlugin["effect"]>(
        (input): input is EffectPlugin["effect"] => typeof input === "function",
      ),
    }),
    Schema.Struct({
      id: Schema.String,
      setup: Schema.declare<PromisePlugin["setup"]>(
        (input): input is PromisePlugin["setup"] => typeof input === "function",
      ),
    }),
  ]),
})

const PluginPackage = Schema.Struct({
  exports: Schema.optional(Schema.Unknown),
  main: Schema.optional(Schema.String),
  module: Schema.optional(Schema.String),
})

export const Plugin = define({
  id: "config-plugin",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const npm = yield* Npm.Service
    yield* Effect.gen(function* () {
      const configured: { package: string; options?: Record<string, any> }[] = []

      for (const entry of yield* config.entries()) {
        if (entry.type === "document") {
          const directory = entry.path ? path.dirname(entry.path) : location.directory
          for (const item of entry.info.plugins ?? []) {
            const ref = typeof item === "string" ? { package: item } : item
            const packageName = (() => {
              if (ref.package.startsWith("file://")) return fileURLToPath(ref.package)
              if (ref.package.startsWith("./") || ref.package.startsWith("../")) {
                return path.resolve(directory, ref.package)
              }
              return ref.package
            })()
            configured.push({ package: packageName, options: ref.options })
          }
        }

        if (entry.type === "directory") {
          const files = yield* fs
            .glob("{plugin,plugins}/*.{ts,js}", {
              cwd: entry.path,
              absolute: true,
              include: "file",
              dot: true,
              symlink: true,
            })
            .pipe(Effect.orElseSucceed(() => []))
          const directories = yield* fs
            .glob("{plugin,plugins}/*", {
              cwd: entry.path,
              absolute: true,
              include: "all",
              dot: true,
              symlink: true,
            })
            .pipe(
              Effect.flatMap((items) =>
                Effect.filter(items, (item) => fs.isDir(item), {
                  concurrency: "unbounded",
                }),
              ),
              Effect.orElseSucceed(() => []),
            )
          const packages = yield* Effect.forEach(
            directories.sort(),
            (directory) => resolvePackageEntrypoint(fs, directory),
            { concurrency: "unbounded" },
          ).pipe(Effect.map((items) => items.filter((item): item is string => item !== undefined)))
          files.sort()
          for (const file of files) configured.push({ package: file })
          for (const file of packages) configured.push({ package: file })
        }
      }

      for (const ref of configured) {
        yield* Effect.gen(function* () {
          const entrypoint = path.isAbsolute(ref.package)
            ? pathToFileURL(ref.package).href
            : (yield* npm.add(ref.package)).entrypoint
          if (!entrypoint) return
          yield* Effect.log({ msg: "loading plugin", id: ref.package, entrypoint })
          const mod = yield* Effect.promise(() => import(entrypoint))
          const value = (yield* Schema.decodeUnknownEffect(PluginModule)(mod)).default
          const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
          yield* ctx.plugin.add({
            id: plugin.id,
            effect: (host) => plugin.effect({ ...host, options: ref.options ?? {} }),
          })
        }).pipe(Effect.ignoreCause)
      }
    })
  }),
})

const resolvePackageEntrypoint = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  const pkg = yield* fs.readJson(path.join(directory, "package.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PluginPackage)),
    Effect.catch(() => Effect.succeed(undefined)),
  )
  const exported = typeof pkg?.exports === "string" ? pkg.exports : undefined
  const entries = [exported, pkg?.module, pkg?.main, "index.ts", "index.js"]

  return yield* Effect.forEach(entries, (entry) => {
    if (!entry) return Effect.succeed(undefined)
    const file = path.resolve(directory, entry)
    return fs.isFile(file).pipe(Effect.map((exists) => (exists ? file : undefined)))
  }).pipe(Effect.map((items) => items.find((item): item is string => item !== undefined)))
})
