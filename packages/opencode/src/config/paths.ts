export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

/** Project config dir basenames. `.opencode` first, `.moks` second so moks wins on name conflicts. */
export const PROJECT_DIR_NAMES = [".opencode", ".moks"] as const

/**
 * Nested / project config basenames loaded in this order (later wins merge).
 * Legacy opencode first, then moks; within each family json then jsonc so jsonc wins.
 */
export const CONFIG_FILE_NAMES = ["opencode.json", "opencode.jsonc", "moks.json", "moks.jsonc"] as const

/** Config basenames without extension, legacy first so dual-load can prefer moks after. */
export const CONFIG_STEMS = ["opencode", "moks"] as const

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

/**
 * Dual-load project config files (opencode + moks), root-first.
 * Within each directory: opencode then moks so moks wins when both are present.
 */
export const projectConfigFiles = Effect.fn("ConfigPaths.projectConfigFiles")(function* (
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  // Leaf-first discovery; group by dir so we can reverse only directory order.
  // Within a directory `up` pushes targets in CONFIG_FILE_NAMES order (opencode then moks).
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

/** opencode then moks config paths in a directory (for dual-load migrate / nested dirs). */
export function configFilesInDirectory(dir: string) {
  return CONFIG_STEMS.flatMap((name) => fileInDirectory(dir, name))
}
