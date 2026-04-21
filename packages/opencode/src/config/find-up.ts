export * as ConfigFindUp from "./find-up"

import path from "path"
import { Effect, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

export const Mode = Schema.Literal("git_submodule")
export type Mode = Schema.Schema.Type<typeof Mode>

export const Info = Schema.Struct({
  find_up: Schema.optional(Mode).annotate({
    description: "Continue local discovery past the current git root to the next enclosing git root.",
  }),
})

export type Info = Schema.Schema.Type<typeof Info>

export const stop = Effect.fn("ConfigFindUp.stop")(function* (
  fs: AppFileSystem.Interface,
  current: string,
  config?: { find_up?: Mode },
) {
  if (config?.find_up !== "git_submodule") return current
  const result = yield* nextGitRoot(fs, path.dirname(current))
  return result ?? current
})

const nextGitRoot = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, start: string) {
  const matches = yield* fs.up({
    targets: [".git"],
    start,
  })
  const first = matches[0]
  if (!first) return
  return path.dirname(first)
})
