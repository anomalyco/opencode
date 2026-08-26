export * as PluginSourceDirectory from "./source-directory.js"

import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Option, Predicate, Schema } from "effect"
import path from "path"

export const names = ["plugin", "plugins"] as const

const Package = Schema.Struct({
  exports: Schema.optional(Schema.Unknown),
  module: Schema.optional(Schema.Unknown),
  main: Schema.optional(Schema.Unknown),
})
const decodePackage = Schema.decodeUnknownOption(Package)

export const discover = Effect.fn("PluginSourceDirectory.discover")(function* (
  fs: FSUtil.Interface,
  directory: string,
) {
  const children = (yield* Effect.forEach(names, (source) =>
    fs.readDirectoryEntries(path.join(directory, source)).pipe(
      Effect.orElseSucceed(() => []),
      Effect.map((entries) => entries.map((entry) => ({ ...entry, target: path.join(directory, source, entry.name) }))),
    ),
  ))
    .flat()
    .sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
  const targets = yield* Effect.forEach(children, (entry) =>
    Effect.gen(function* () {
      const source = entry.target.endsWith(".ts") || entry.target.endsWith(".js")
      if (entry.type === "file" && source) return Option.some(entry.target)
      if (entry.type === "directory") return yield* packageEntry(fs, entry.target)
      if (entry.type !== "symlink") return Option.none<string>()
      if (source && (yield* fs.isFile(entry.target))) return Option.some(entry.target)
      if (yield* fs.isDir(entry.target)) return yield* packageEntry(fs, entry.target)
      return Option.none<string>()
    }),
  )
  return targets.flatMap(Option.toArray)
})

function packageEntry(fs: FSUtil.Interface, directory: string) {
  return Effect.gen(function* () {
    const root = yield* fs.resolve(directory)
    const manifest = yield* fs
      .readJson(path.join(directory, "package.json"))
      .pipe(Effect.map(decodePackage), Effect.orElseSucceed(Option.none))
    const configured = Option.isSome(manifest)
      ? [manifest.value.exports, manifest.value.module, manifest.value.main].filter(Predicate.isString)
      : []
    return yield* Effect.findFirst(
      [...configured, "index.ts", "index.js"]
        .filter((entry) => !path.isAbsolute(entry))
        .map((entry) => path.resolve(directory, entry))
        .filter((entry) => FSUtil.contains(directory, entry)),
      (entry) =>
        fs
          .isFile(entry)
          .pipe(
            Effect.flatMap((exists) =>
              exists
                ? fs.resolve(entry).pipe(Effect.map((resolved) => FSUtil.contains(root, resolved)))
                : Effect.succeed(false),
            ),
          ),
    )
  })
}
