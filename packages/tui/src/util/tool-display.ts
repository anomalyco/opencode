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

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
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
import type { SessionMessageAssistantTool } from "@opencode-ai/client/promise"
