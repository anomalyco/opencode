export * as ConfigAgent from "./agent"

import path from "path"
import { Cause, Exit, Schema } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"

export interface LoadError {
  readonly path: string
  readonly message: string
}

export interface LoadResult {
  readonly agents: Record<string, ConfigAgentV1.Info>
  readonly errors: ReadonlyArray<LoadError>
}

const decodeInfo = Schema.decodeUnknownExit(ConfigAgentV1.Info)

export async function load(dir: string): Promise<LoadResult> {
  const agents: Record<string, ConfigAgentV1.Info> = {}
  const errors: Array<LoadError> = []
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch((err) => {
      errors.push({ path: item, message: `Failed to parse frontmatter: ${String(err)}` })
      return undefined
    })
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["agent/", "agents/"])

    const config = {
      name,
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = decodeInfo(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      agents[config.name] = parsed.value
      continue
    }
    errors.push({ path: item, message: Cause.pretty(parsed.cause) })
  }
  return { agents, errors }
}

export async function loadMode(dir: string): Promise<LoadResult> {
  const agents: Record<string, ConfigAgentV1.Info> = {}
  const errors: Array<LoadError> = []
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch((err) => {
      errors.push({ path: item, message: `Failed to parse frontmatter: ${String(err)}` })
      return undefined
    })
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(path.relative(dir, item), ["mode/", "modes/"]),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = decodeInfo(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      agents[config.name] = {
        ...parsed.value,
        mode: "primary" as const,
      }
      continue
    }
    errors.push({ path: item, message: Cause.pretty(parsed.cause) })
  }
  return { agents, errors }
}
