export * as ConfigCommand from "./command"

import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Effect, Exit, Schema } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ConfigCommandV1 } from "@opencode-ai/core/v1/config/command"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import * as ConfigMarkdown from "./markdown"

const log = Log.create({ service: "config" })

const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_COMMAND_PATTERN = "{command,commands}/**/*.md"
const CUSTOM_PATH_COMMAND_PATTERN = "**/*.md"

const decodeInfo = Schema.decodeUnknownExit(ConfigCommandV1.Info)

async function parseCommandFile(
  item: string,
  name: string,
): Promise<{ name: string; value: ConfigCommandV1.Info } | undefined> {
  const md = await ConfigMarkdown.parse(item).catch((err) => {
    log.error("failed to load command", { command: item, err })
    return undefined
  })
  if (!md) return undefined

  const config = {
    name,
    ...md.data,
    template: md.content.trim(),
  }
  const parsed = decodeInfo(config, { errors: "all", propertyOrder: "original" })
  if (Exit.isSuccess(parsed)) {
    return { name: config.name, value: parsed.value }
  }
  throw new InvalidError({ path: item, message: Cause.pretty(parsed.cause) }, { cause: Cause.squash(parsed.cause) })
}

export async function load(dir: string) {
  const result: Record<string, ConfigCommandV1.Info> = {}
  for (const item of await Glob.scan("{command,commands}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const name = configEntryNameFromPath(path.relative(dir, item), ["command/", "commands/"])
    const parsed = await parseCommandFile(item, name)
    if (parsed) result[parsed.name] = parsed.value
  }
  return result
}

const scanDir = Effect.fnUntraced(function* (state: Map<string, string>, root: string, pattern: string) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        dot: true,
        symlink: true,
      }),
    catch: () => [] as string[],
  })
  for (const match of matches) {
    state.set(match, root)
  }
})

export const loadExternal = Effect.fnUntraced(function* (
  fsys: FSUtil.Interface,
  directory: string,
  worktree: string,
  extraPaths: string[] = [],
) {
  const matches = new Map<string, string>()
  const externalDirs = [CLAUDE_EXTERNAL_DIR, AGENTS_EXTERNAL_DIR]

  for (const dir of externalDirs) {
    const root = path.join(Global.Path.home, dir)
    if (!(yield* fsys.isDir(root))) continue
    yield* scanDir(matches, root, EXTERNAL_COMMAND_PATTERN)
  }

  const upDirs = yield* fsys
    .up({ targets: externalDirs, start: directory, stop: worktree })
    .pipe(Effect.catch(() => Effect.succeed([] as string[])))
  for (const root of upDirs) {
    yield* scanDir(matches, root, EXTERNAL_COMMAND_PATTERN)
  }

  for (const item of extraPaths) {
    const expanded = item.startsWith("~/") ? path.join(Global.Path.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      log.warn("command path not found", { path: dir })
      continue
    }
    yield* scanDir(matches, dir, CUSTOM_PATH_COMMAND_PATTERN)
  }

  const result: Record<string, ConfigCommandV1.Info> = {}
  for (const [item, baseDir] of matches) {
    const name = configEntryNameFromPath(path.relative(baseDir, item), ["command/", "commands/"])
    const parsed = yield* Effect.tryPromise({
      try: () => parseCommandFile(item, name),
      catch: (err) => {
        log.error("failed to load external command", { command: item, err })
        return undefined
      },
    })
    if (parsed) result[parsed.name] = parsed.value
  }

  log.info("loaded external commands", { count: Object.keys(result).length })
  return result
})
