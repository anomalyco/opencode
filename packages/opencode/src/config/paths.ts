export * as ConfigPaths from "./paths"

import path from "path"
import { existsSync } from "fs"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

/** OpenCode project basenames (jsonc preferred over json within the family). */
export const OPENCODE_CONFIG_FILE_CANDIDATES = ["opencode.jsonc", "opencode.json"] as const

/** KanCode project basenames (jsonc preferred over json within the family). */
export const KANCODE_CONFIG_FILE_CANDIDATES = ["kancode.jsonc", "kancode.json"] as const

/**
 * Project-scope basenames for discovery/scans.
 * Prefer KanCode names first for writable helpers; merge load order is OpenCode then KanCode.
 */
export const CONFIG_FILE_CANDIDATES = [...KANCODE_CONFIG_FILE_CANDIDATES, ...OPENCODE_CONFIG_FILE_CANDIDATES] as const

/** User-scope (XDG/global, home) basenames: KanCode only — no opencode.json fallback. */
export const USER_CONFIG_FILE_CANDIDATES = ["kancode.jsonc", "kancode.json"] as const

/** Project dirs: load `.opencode` then `.kancode` so KanCode wins on merge conflict. */
export const PROJECT_DIR_TARGETS = [".opencode", ".kancode"] as const

/** User-scope home project dir: `.kancode` only — do not discover `~/.opencode`. */
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
 * Project-scope files in one directory, merge order: OpenCode first, then KanCode
 * (KanCode overrides). Within each family, jsonc wins over json (one file per family).
 */
export function projectConfigFilesInDirectory(dir: string) {
  const files: string[] = []
  const opencode = preferredConfigFile(dir, OPENCODE_CONFIG_FILE_CANDIDATES)
  if (opencode) files.push(opencode)
  const kancode = preferredConfigFile(dir, KANCODE_CONFIG_FILE_CANDIDATES)
  if (kancode) files.push(kancode)
  return files
}

/**
 * Path to mutate for config writes. Without `project`, treats `baseDir` as
 * user/global scope (KanCode filenames only). With `project: true`, dual-reads
 * KanCode/OpenCode names and also checks `.kancode/` then `.opencode/`.
 * Defaults to `kancode.json` so writers do not create a shadowed OpenCode file.
 */
export function resolveWritableConfigFile(baseDir: string, opts?: { project?: boolean }) {
  if (opts?.project) {
    const root = preferredConfigFile(baseDir)
    if (root) return root
    const kancode = preferredConfigFile(path.join(baseDir, ".kancode"))
    if (kancode) return kancode
    const opencode = preferredConfigFile(path.join(baseDir, ".opencode"))
    if (opencode) return opencode
    return path.join(baseDir, "kancode.json")
  }
  const root = preferredUserConfigFile(baseDir)
  if (root) return root
  return path.join(baseDir, "kancode.json")
}

/**
 * Project config dir for writes: reuse existing `.kancode` or `.opencode`,
 * otherwise create `.kancode`.
 */
export function resolveWritableProjectDir(baseDir: string) {
  const kancode = path.join(baseDir, ".kancode")
  if (existsSync(kancode)) return kancode
  const opencode = path.join(baseDir, ".opencode")
  if (existsSync(opencode)) return opencode
  return kancode
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

/**
 * Walk up project ancestry and include both OpenCode and KanCode config files
 * per directory (merge-include; OpenCode then KanCode so KanCode wins).
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
    // User-scope home: `.kancode` only (never `~/.opencode`).
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

/** All KanCode/OpenCode config paths in a directory (for project migration scans). */
export function appConfigFilesInDirectory(dir: string) {
  return CONFIG_FILE_CANDIDATES.map((name) => path.join(dir, name))
}

/** User-scope config paths only (global/XDG migration scans). */
export function userConfigFilesInDirectory(dir: string) {
  return USER_CONFIG_FILE_CANDIDATES.map((name) => path.join(dir, name))
}
