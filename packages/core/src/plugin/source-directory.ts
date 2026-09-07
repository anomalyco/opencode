export * as PluginSourceDirectory from "./source-directory.js"

import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Option } from "effect"
import path from "path"

export const names = ["plugin", "plugins"] as const

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
      if (entry.type === "directory") return Option.some(entry.target)
      if (entry.type !== "symlink") return Option.none<string>()
      if (source && (yield* fs.isFile(entry.target))) return Option.some(entry.target)
      if (yield* fs.isDir(entry.target)) return Option.some(entry.target)
      return Option.none<string>()
    }),
  )
  return targets.flatMap(Option.toArray)
})
