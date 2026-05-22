export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import { Effect, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* AppFileSystem.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (
  directory: string,
  worktree?: string,
  options: { configDir?: Option.Option<string>; disableProjectConfig?: boolean } = {},
) {
  const afs = yield* AppFileSystem.Service
  const configDir = options.configDir ?? Option.fromUndefinedOr(Flag.OPENCODE_CONFIG_DIR)
  return unique([
    Global.Path.config,
    ...(!(options.disableProjectConfig ?? Flag.OPENCODE_DISABLE_PROJECT_CONFIG)
      ? yield* afs.up({
          targets: [".opencode"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".opencode"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...Option.toArray(configDir),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
