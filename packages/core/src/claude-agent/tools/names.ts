export * as ToolNames from "./names.js"

import { createHash } from "node:crypto"
import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider"

export const PREFIX = "mcp__opencode__"

export function short(name: string) {
  const limit = 64 - PREFIX.length
  if (name.length <= limit && /^[a-zA-Z0-9_-]+$/.test(name)) return name
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 10)
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, limit - 11) + "_" + hash
}

export function original(name: string, tools: readonly LanguageModelV3FunctionTool[]) {
  const tool = tools.find((tool) => PREFIX + short(tool.name) === name)
  if (tool) return tool.name
  throw new Error(`Claude Code called an unregistered OpenCode tool: ${name}`)
}

export function description(tool: LanguageModelV3FunctionTool) {
  const text = tool.description ?? ""
  if ((tool.name !== "subagent" && tool.name !== "task") || text.length <= 2048) return text.slice(0, 2048)
  const agents = /(?:Available (?:sub)?agents|Currently available agent types):/i.exec(text)
  if (!agents) return text.slice(0, 2048)
  return (text.slice(agents.index) + "\n\n" + text.slice(0, agents.index)).slice(0, 2048)
}
