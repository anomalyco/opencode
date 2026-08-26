export * as ConfigAgent from "./agent"

import path from "path"
import { Exit, Schema } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigParse } from "./parse"

/**
 * An unresolved `{file:...}` reference, tagged with the agent and source file it
 * came from. Callers are responsible for surfacing these; the loaders themselves
 * run outside the Effect runtime and have no logger.
 */
export interface InterpolationWarning {
  agent: string
  source: string
  error: ConfigMarkdown.InterpolationError
}

export async function load(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  const warnings: InterpolationWarning[] = []
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["agent/", "agents/"])

    const interp = await ConfigMarkdown.interpolateFiles(md.content, path.dirname(item))
    for (const error of interp.errors) warnings.push({ agent: name, source: item, error })

    const config = {
      name,
      ...md.data,
      prompt: interp.content.trim(),
    }
    result[config.name] = ConfigParse.schema(ConfigAgentV1.Info, config, item)
  }
  return { agent: result, warnings }
}

export async function loadMode(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  const warnings: InterpolationWarning[] = []
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["mode/", "modes/"])

    const interp = await ConfigMarkdown.interpolateFiles(md.content, path.dirname(item))
    for (const error of interp.errors) warnings.push({ agent: name, source: item, error })

    const config = {
      name,
      ...md.data,
      prompt: interp.content.trim(),
    }
    const parsed = Schema.decodeUnknownExit(ConfigAgentV1.Info)(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[config.name] = {
        ...parsed.value,
        mode: "primary" as const,
      }
    }
  }
  return { agent: result, warnings }
}
