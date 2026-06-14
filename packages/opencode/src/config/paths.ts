export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@daemon-protocol/core/flag/flag"
import { Global } from "@daemon-protocol/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@daemon-protocol/core/fs-util"

const LEGACY_CONFIG_NAMES = ["opencode"] as const
const CONFIG_DIR_NAMES = [".daemoncode", ".opencode"] as const

const configNamesFor = (name: string) => (name === "daemoncode" ? [name, ...LEGACY_CONFIG_NAMES] : [name])

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  const names = configNamesFor(name)
  const targets = names.flatMap((configName) => [`${configName}.jsonc`, `${configName}.json`])
  return (yield* afs.up({
    targets,
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [...CONFIG_DIR_NAMES],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [...CONFIG_DIR_NAMES],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return configNamesFor(name).flatMap((configName) => [
    path.join(dir, `${configName}.json`),
    path.join(dir, `${configName}.jsonc`),
  ])
}
