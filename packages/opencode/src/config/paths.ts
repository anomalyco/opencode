export * as ConfigPaths from "./paths"

import path from "path"
import { existsSync } from "fs"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

/** Preferred config basenames: KanCode first, then OpenCode. First existing wins per directory. */
export const CONFIG_FILE_CANDIDATES = ["kancode.jsonc", "kancode.json", "opencode.jsonc", "opencode.json"] as const

/** Project dirs: load `.opencode` then `.kancode` so KanCode wins on merge conflict. */
export const PROJECT_DIR_TARGETS = [".opencode", ".kancode"] as const

export function preferredConfigFile(dir: string) {
  for (const name of CONFIG_FILE_CANDIDATES) {
    const file = path.join(dir, name)
    if (existsSync(file)) return file
  }
}

export function isProjectConfigDir(dir: string) {
  return dir.endsWith(".opencode") || dir.endsWith(".kancode") || dir === Flag.OPENCODE_CONFIG_DIR
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

/** Walk up and pick one preferred app config file per directory (kancode > opencode). */
export const configFiles = Effect.fn("ConfigPaths.configFiles")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  const found = yield* afs.up({
    targets: [...CONFIG_FILE_CANDIDATES],
    start: directory,
    stop: worktree,
  })
  const byDir = new Map<string, string>()
  for (const file of found) {
    const dir = path.dirname(file)
    if (byDir.has(dir)) continue
    byDir.set(dir, file)
  }
  return [...byDir.values()].toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [...PROJECT_DIR_TARGETS],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [...PROJECT_DIR_TARGETS],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

/** All KanCode/OpenCode config paths in a directory (for migration scans). */
export function appConfigFilesInDirectory(dir: string) {
  return CONFIG_FILE_CANDIDATES.map((name) => path.join(dir, name))
}
