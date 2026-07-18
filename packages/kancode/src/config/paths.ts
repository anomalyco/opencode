export * as ConfigPaths from "./paths"

import path from "path"
import { existsSync } from "fs"
import { Flag } from "@kancode/core/flag/flag"
import { Global } from "@kancode/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@kancode/core/fs-util"

/** Legacy OpenCode basenames kept for one-time migration scans only. */
export const OPENCODE_CONFIG_FILE_CANDIDATES = ["opencode.jsonc", "opencode.json"] as const

/** KanCode project/user basenames (jsonc preferred over json within the family). */
export const KANCODE_CONFIG_FILE_CANDIDATES = ["kancode.jsonc", "kancode.json"] as const

/** Project-scope basenames for config load and writable helpers. */
export const CONFIG_FILE_CANDIDATES = [...KANCODE_CONFIG_FILE_CANDIDATES] as const

/** User-scope (XDG/global, home) basenames: KanCode only. */
export const USER_CONFIG_FILE_CANDIDATES = ["kancode.jsonc", "kancode.json"] as const

/**
 * Migration scans may still find legacy OpenCode filenames so tui keys can be
 * extracted. Runtime project load does not use this list.
 */
export const MIGRATION_CONFIG_FILE_CANDIDATES = [
  ...KANCODE_CONFIG_FILE_CANDIDATES,
  ...OPENCODE_CONFIG_FILE_CANDIDATES,
] as const

/** Project config dir: `.kancode` only — project `.opencode` is not discovered. */
export const PROJECT_DIR_TARGETS = [".kancode"] as const

/** User-scope home project dir: `.kancode` only. */
export const USER_DIR_TARGETS = [".kancode"] as const

export function preferredConfigFile(dir: string, candidates: readonly string[] = CONFIG_FILE_CANDIDATES) {
  for (const name of candidates) {
    const file = path.join(dir, name)
    if (existsSync(file)) return file
  }
}

/** Preferred file under user-scope dirs (global/XDG): KanCode names only. */
export function preferredUserConfigFile(dir: string) {
  return preferredConfigFile(dir, USER_CONFIG_FILE_CANDIDATES)
}

/**
 * Project-scope config files in one directory (at most one: jsonc preferred over json).
 */
export function projectConfigFilesInDirectory(dir: string) {
  const file = preferredConfigFile(dir, KANCODE_CONFIG_FILE_CANDIDATES)
  return file ? [file] : []
}

/**
 * Path to mutate for config writes. Without `project`, treats `baseDir` as
 * user/global scope. With `project: true`, checks root then `.kancode/` for an
 * existing KanCode config file. Defaults to `kancode.json`.
 */
export function resolveWritableConfigFile(baseDir: string, opts?: { project?: boolean }) {
  if (opts?.project) {
    const root = preferredConfigFile(baseDir)
    if (root) return root
    const kancode = preferredConfigFile(path.join(baseDir, ".kancode"))
    if (kancode) return kancode
    return path.join(baseDir, "kancode.json")
  }
  const root = preferredUserConfigFile(baseDir)
  if (root) return root
  return path.join(baseDir, "kancode.json")
}

/** Project config dir for writes: always `.kancode`. */
export function resolveWritableProjectDir(baseDir: string) {
  return path.join(baseDir, ".kancode")
}

export function isProjectConfigDir(dir: string) {
  return dir.endsWith(".kancode") || dir === Flag.OPENCODE_CONFIG_DIR
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
 * Walk up project ancestry and include KanCode config files per directory.
 */
export const configFiles = Effect.fn("ConfigPaths.configFiles")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  const found = yield* afs.up({
    targets: [...CONFIG_FILE_CANDIDATES],
    start: directory,
    stop: worktree,
  })
  const dirs: string[] = []
  const seen = new Set<string>()
  for (const file of found) {
    const dir = path.dirname(file)
    if (seen.has(dir)) continue
    seen.add(dir)
    dirs.push(dir)
  }
  return dirs.toReversed().flatMap((dir) => projectConfigFilesInDirectory(dir))
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
    // User-scope home: `.kancode` only.
    ...(yield* afs.up({
      targets: [...USER_DIR_TARGETS],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

/** All KanCode/legacy OpenCode config paths in a directory (for migration scans). */
export function appConfigFilesInDirectory(dir: string) {
  return MIGRATION_CONFIG_FILE_CANDIDATES.map((name) => path.join(dir, name))
}

/** User-scope config paths only (global/XDG migration scans). */
export function userConfigFilesInDirectory(dir: string) {
  return USER_CONFIG_FILE_CANDIDATES.map((name) => path.join(dir, name))
}
