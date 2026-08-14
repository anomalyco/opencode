export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@moks/core/flag/flag"
import { Global } from "@moks/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@moks/core/fs-util"

/** Project config dir basename. OpenCode `.opencode/` is not loaded. */
export const PROJECT_DIR_NAMES = [".moks"] as const

/** Nested / project config basenames. json then jsonc so jsonc wins. */
export const CONFIG_FILE_NAMES = ["moks.json", "moks.jsonc"] as const

export const CONFIG_STEMS = ["moks"] as const

export function isProjectConfigDir(dir: string) {
  const base = path.basename(dir)
  return (PROJECT_DIR_NAMES as readonly string[]).includes(base)
}

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

/** Project config files, root-first. Within a directory: json then jsonc. */
export const projectConfigFiles = Effect.fn("ConfigPaths.projectConfigFiles")(function* (
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  // Leaf-first discovery; group by dir so we can reverse only directory order.
  // Within a directory `up` pushes targets in CONFIG_FILE_NAMES order.
  const leafFirst = yield* afs.up({
    targets: [...CONFIG_FILE_NAMES],
    start: directory,
    stop: worktree,
  })
  const byDir = new Map<string, string[]>()
  const leafDirOrder: string[] = []
  for (const file of leafFirst) {
    const dir = path.dirname(file)
    const list = byDir.get(dir)
    if (!list) {
      byDir.set(dir, [file])
      leafDirOrder.push(dir)
      continue
    }
    list.push(file)
  }
  return leafDirOrder.toReversed().flatMap((dir) => byDir.get(dir)!)
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [...PROJECT_DIR_NAMES],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [...PROJECT_DIR_NAMES],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

/** moks config paths in a directory. */
export function configFilesInDirectory(dir: string) {
  return CONFIG_STEMS.flatMap((name) => fileInDirectory(dir, name))
}
