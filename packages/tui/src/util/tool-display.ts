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

export function primitiveInputSummary(input: Record<string, unknown>, omit: readonly string[] = []) {
  const entries = Object.entries(input).filter(([key, value]) => {
    if (omit.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (entries.length === 0) return ""
  return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")}]`
}

export function readRangeSuffix(state: SessionMessageAssistantTool["state"]) {
  if (state.status === "streaming") return ""
  const offset = finiteNumber(state.input.offset)
  const limit = finiteNumber(state.input.limit)
  if (offset === undefined && limit === undefined) return ""

  if (state.status === "completed") {
    // The read tool's first content line reports the returned range, including EOF/byte-cap clipping.
    const summary = state.content.find((content) => content.type === "text")?.text.split("\n", 1)[0]
    const range = summary?.match(/^Read (?:file .+, lines|directory .+, entries) (\d+)-(\d+)$/)
    return range ? `:${range[1]}-${range[2]}` : ""
  }
  if (state.status === "error") return ""
  const start = offset || 1
  return `:${start}-${limit ? start + limit - 1 : ""}`
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

export function executeCallSummary(call: ExecuteCall) {
  const args = primitiveInputSummary(call.input ?? {}).replace(/\s+/g, " ")
  return `${call.tool}${args ? ` ${args}` : ""}`
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
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { isRecord } from "./record"
