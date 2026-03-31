import type { CallTraceItem, TraceSource } from "../context/call-trace"

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function formatTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8)
}

export function truncate(s: string | undefined, max: number): string {
  if (!s) return ""
  return s.length <= max ? s : s.slice(0, max - 1) + "…"
}

export function formatTokens(tokens?: { input: number; output: number }): string {
  return tokens ? `${tokens.input}→${tokens.output}` : ""
}

export function formatCost(cost?: number): string {
  return cost !== undefined ? `$${cost.toFixed(4)}` : ""
}

export function formatInput(trace: CallTraceItem): string {
  if (trace.inputSummary) return trace.inputSummary
  if (trace.type === "llm") {
    const parts = []
    if (trace.providerID) parts.push(trace.providerID)
    if (trace.modelID) parts.push(trace.modelID)
    if (trace.tokens) parts.push(`tokens: ${trace.tokens.input}`)
    return parts.join(" | ") || "LLM call"
  }
  if (trace.type === "tool") {
    const params = trace.input ? Object.keys(trace.input).join(", ") : ""
    return trace.toolName ? `${trace.toolName}(${params})` : "Tool call"
  }
  if (trace.type === "omo") {
    return trace.agentName || trace.description || "OMO agent"
  }
  return ""
}

export function formatOutput(trace: CallTraceItem): string {
  if (trace.outputSummary) return trace.outputSummary
  if (trace.type === "llm") {
    const parts = []
    if (trace.tokens) parts.push(`tokens: ${trace.tokens.output}`)
    if (trace.cost !== undefined) parts.push(formatCost(trace.cost))
    return parts.join(" | ") || ""
  }
  if (trace.type === "tool") {
    return trace.output ? truncate(trace.output, 100) : ""
  }
  if (trace.type === "omo") {
    return trace.sessionID ? `session: ${trace.sessionID}` : ""
  }
  return ""
}

export const SOURCE_COLORS: Record<TraceSource, string> = {
  OC: "info",
  OMO: "warning",
  LLM: "success",
}
