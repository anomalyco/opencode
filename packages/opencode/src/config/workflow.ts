export * as ConfigWorkflow from "./workflow"

import path from "path"
import { Cause, Exit, Schema } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigWorkflowV1 } from "@opencode-ai/core/v1/config/workflow"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import matter from "gray-matter"

const decodeInfo = Schema.decodeUnknownExit(ConfigWorkflowV1.Info)

function parseYaml(content: string) {
  const result = matter(`---\n${content}\n---`)
  return { data: result.data, content: "" }
}

export async function load(dir: string) {
  const result: Record<string, ConfigWorkflowV1.Info> = {}
  for (const item of await Glob.scan("{workflow,workflows}/**/*.{yaml,yml}", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const raw = await Bun.file(item).text().catch(() => undefined)
    if (!raw) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["workflow/", "workflows/"])

    let data: Record<string, unknown>
    try {
      const parsed = parseYaml(raw)
      data = { name, ...parsed.data }
    } catch (err) {
      throw new InvalidError(
        { path: item, message: `Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}` },
        { cause: err },
      )
    }

    const parsed = decodeInfo(data, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[name] = parsed.value
      continue
    }
    throw new InvalidError({ path: item, message: Cause.pretty(parsed.cause) }, { cause: Cause.squash(parsed.cause) })
  }
  return result
}
