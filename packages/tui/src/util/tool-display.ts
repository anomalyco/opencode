import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { Locale } from "./locale"
import { isRecord } from "./record"
import { stringWidth } from "./string-width"

const MAX_SUMMARY_VALUE_WIDTH = 40
const MAX_SUMMARY_WIDTH = 120

export function canonicalToolName(name: string) {
  if (name === "bash") return "shell"
  if (name === "task") return "subagent"
  if (name === "apply_patch") return "patch"
  return name
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return
  return value
}

export function primitiveInputSummary(
  input: Record<string, unknown>,
  omit: readonly string[] = [],
  maxWidth = MAX_SUMMARY_WIDTH,
) {
  if (maxWidth <= 0) return ""
  const entries = Object.entries(input).filter(([key, value]) => {
    if (omit.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (entries.length === 0) return ""
  const body = entries
    .map(([key, value]) => {
      const normalized = typeof value === "string" ? value.replace(/\s+/g, " ") : String(value)
      return `${key.replace(/\s+/g, " ")}=${Locale.truncateWidth(normalized, MAX_SUMMARY_VALUE_WIDTH)}`
    })
    .join(", ")
  if (maxWidth <= 2) return Locale.truncateWidth(`[${body}]`, maxWidth)
  return `[${Locale.truncateWidth(body, maxWidth - 2)}]`
}

export function genericToolSummary(tool: string, input: Record<string, unknown>, maxWidth = MAX_SUMMARY_WIDTH) {
  if (maxWidth <= 0) return ""
  const name = tool.replace(/\s+/g, " ")
  const nameWidth = stringWidth(name)
  if (nameWidth >= maxWidth) return Locale.truncateWidth(name, maxWidth)
  const remaining = maxWidth - nameWidth - 1
  const args = primitiveInputSummary(input, [], remaining >= 3 ? remaining : MAX_SUMMARY_WIDTH)
  if (!args) return name
  if (remaining < 3) return Locale.truncateWidth(`${name} ${args}`, maxWidth)
  return `${name} ${args}`
}

export type ExecuteCall = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

export function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    if (!isRecord(call)) return []
    const tool = call.tool
    const status = call.status
    if (typeof tool !== "string" || (status !== "running" && status !== "completed" && status !== "error")) return []
    return [{ tool, status, input: isRecord(call.input) ? call.input : undefined }]
  })
}

export function executeCallSummary(call: ExecuteCall, maxWidth = MAX_SUMMARY_WIDTH) {
  return genericToolSummary(call.tool, call.input ?? {}, maxWidth)
}

export function webSearchProviderName(provider: unknown) {
  if (typeof provider !== "string" || !provider) return ""
  if (provider === "opencode") return "OpenCode"
  return `${provider[0].toUpperCase()}${provider.slice(1)}`
}

export function webSearchProviderLabel(provider: unknown) {
  const name = webSearchProviderName(provider)
  return name ? `Web Search via ${name}` : "Web Search"
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "streaming") return {}
  if (!("metadata" in state) || !state.metadata || typeof state.metadata !== "object") return {}
  if (Array.isArray(state.metadata)) return {}
  return state.metadata as Record<string, unknown>
}

export function toolDisplayContent(state: SessionMessageAssistantTool["state"]) {
  if (state.status === "streaming" || state.status === "running") return []
  return state.content ?? []
}

export function nonEmptyToolContent<T>(content: ReadonlyArray<T> | undefined): [T, ...T[]] | undefined {
  if (!content) return undefined
  const [first, ...rest] = content
  return first === undefined ? undefined : [first, ...rest]
}
