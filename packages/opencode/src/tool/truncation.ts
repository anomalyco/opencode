import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Identifier } from "../id/id"
import { lazy } from "../util/lazy"
import { PermissionNext } from "../permission/next"
import type { Agent } from "../agent/agent"
import type { Provider } from "../provider/provider"

export namespace Truncate {
  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024 // Fallback default
  export const MAX_METADATA = 30_000 // Fallback default
  export const DIR = path.join(Global.Path.data, "tool-output")
  export const GLOB = path.join(DIR, "*")
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

  /**
   * Calculate max bytes for tool output based on model's context size.
   * Automatically scales limits based on model capabilities.
   *
   * Formula: context * 0.05 * 4
   *   - Uses 5% of model's context window for tool output
   *   - Converts tokens to bytes (4 chars per token)
   *
   * Examples:
   *   - GPT-4 (128k):   25.6KB output limit
   *   - Claude (200k):  40KB output limit
   *   - Gemini (2M):    400KB output limit
   *
   * Bounds: min 10KB, max 2MB
   *
   * Note: This is different from compaction.maxContext
   *   - compaction.maxContext: Limits total conversation context
   *   - getMaxBytes: Limits individual tool call output
   */
  export function getMaxBytes(model?: Provider.Model): number {
    if (!model?.limit?.context) return MAX_BYTES
    const contextLimit = model.limit.context
    if (contextLimit === 0) return MAX_BYTES

    // 5% of context converted to bytes (4 chars per token)
    const calculated = Math.floor(contextLimit * 0.05 * 4)

    // Minimum 10KB, maximum 2MB
    return Math.max(10 * 1024, Math.min(calculated, 2 * 1024 * 1024))
  }

  /**
   * Calculate max metadata bytes (60% of max output bytes).
   * Metadata is shown in UI while output goes to the model.
   * Using 60% prevents UI from being overwhelmed with large outputs.
   */
  export function getMaxMetadata(model?: Provider.Model): number {
    return Math.floor(getMaxBytes(model) * 0.6)
  }

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
    model?: Provider.Model
  }

  export async function cleanup() {
    const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - RETENTION_MS))
    const glob = new Bun.Glob("tool_*")
    const entries = await Array.fromAsync(glob.scan({ cwd: DIR, onlyFiles: true })).catch(() => [] as string[])
    for (const entry of entries) {
      if (Identifier.timestamp(entry) >= cutoff) continue
      await fs.unlink(path.join(DIR, entry)).catch(() => {})
    }
  }

  const init = lazy(cleanup)

  function hasTaskTool(agent?: Agent.Info): boolean {
    if (!agent?.permission) return false
    const rule = PermissionNext.evaluate("task", "*", agent.permission)
    return rule.action !== "deny"
  }

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? getMaxBytes(options.model)
    const direction = options.direction ?? "head"
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    const out: string[] = []
    let i = 0
    let bytes = 0
    let hitBytes = false

    if (direction === "head") {
      for (i = 0; i < lines.length && i < maxLines; i++) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.push(lines[i])
        bytes += size
      }
    } else {
      for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.unshift(lines[i])
        bytes += size
      }
    }

    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "bytes" : "lines"
    const preview = out.join("\n")

    await init()
    const id = Identifier.ascending("tool")
    const filepath = path.join(DIR, id)
    await Bun.write(Bun.file(filepath), text)

    const hint = hasTaskTool(agent)
      ? `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
      : `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
    const message =
      direction === "head"
        ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
        : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

    return { content: message, truncated: true, outputPath: filepath }
  }
}
