import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Identifier } from "../id/id"
import { PermissionNext } from "../permission/next"
import { Token } from "../util/token"
import type { Agent } from "../agent/agent"
import { Scheduler } from "../scheduler"

export namespace Truncate {
  export const MAX_LINES = 2000
  export const MAX_TOKENS = 10_000
  export const DIR = path.join(Global.Path.data, "tool-output")
  export const GLOB = path.join(DIR, "*")
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const HOUR_MS = 60 * 60 * 1000

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxTokens?: number
    direction?: "head" | "tail"
  }

  export function init() {
    Scheduler.register({
      id: "tool.truncation.cleanup",
      interval: HOUR_MS,
      run: cleanup,
      scope: "global",
    })
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

  function hasTaskTool(agent?: Agent.Info): boolean {
    if (!agent?.permission) return false
    const rule = PermissionNext.evaluate("task", "*", agent.permission)
    return rule.action !== "deny"
  }

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxTokens = options.maxTokens ?? MAX_TOKENS
    const direction = options.direction ?? "head"
    const lines = text.split("\n")
    const totalTokens = Token.estimate(text)

    if (lines.length <= maxLines && totalTokens <= maxTokens) {
      return { content: text, truncated: false }
    }

    const out: string[] = []
    let i = 0
    let tokens = 0
    let hitTokens = false

    if (direction === "head") {
      for (i = 0; i < lines.length && i < maxLines; i++) {
        const size = Token.estimate(lines[i]) + (out.length > 0 ? 1 : 0)
        if (tokens + size > maxTokens) {
          hitTokens = true
          break
        }
        out.push(lines[i])
        tokens += size
      }
    } else {
      for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
        const size = Token.estimate(lines[i]) + (out.length > 0 ? 1 : 0)
        if (tokens + size > maxTokens) {
          hitTokens = true
          break
        }
        out.unshift(lines[i])
        tokens += size
      }
    }

    const removed = hitTokens ? totalTokens - tokens : lines.length - out.length
    const unit = hitTokens ? "tokens" : "lines"
    const preview = out.join("\n")

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
