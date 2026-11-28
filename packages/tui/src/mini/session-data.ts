import type { FooterSubagentState, FooterSubagentTab, FooterView, MiniFormRequest, MiniPermissionRequest } from "./types"

export function pickBlockerView(input: { permission?: MiniPermissionRequest; form?: MiniFormRequest }): FooterView {
  if (input.permission) return { type: "permission", request: input.permission }
  if (input.form) return { type: "form", request: input.form }
  return { type: "prompt" }
}

export function blockerStatus(view: FooterView) {
  if (view.type === "permission") return "awaiting permission"
  if (view.type === "form") return "awaiting form"
  return ""
}

/** Active child sessions while the parent stream is quiet (#65343). */
export function descendantActivityStatus(descendant: FooterSubagentState): string {
  const running = descendant.tabs.filter((tab) => tab.status === "running")
  if (running.length === 0) return ""
  const first = running[0]!
  const short = first.sessionID.length > 16 ? first.sessionID.slice(-16) : first.sessionID
  const agent = first.label || first.title || "subagent"
  if (running.length === 1) return `task:${agent} · ${short}`
  return `task:${running.length} active · ${short}`
}

/** Returns the model of the single running child, if exactly one is active (#65343). */
export function descendantActivityModel(
  descendant: FooterSubagentState,
): { providerID: string; modelID: string } | undefined {
  const running = descendant.tabs.filter((tab) => tab.status === "running")
  if (running.length !== 1) return undefined
  return running[0]!.model
}

export function footerActivityStatus(
  view: FooterView,
  descendant: FooterSubagentState,
  rootActive: boolean,
): { phase: "idle" | "running"; status: string } {
  if (rootActive) return { phase: "running", status: "assistant responding" }
  const blocked = blockerStatus(view)
  if (blocked) return { phase: "running", status: blocked }
  const child = descendantActivityStatus(descendant)
  // Parent is idle; child activity shows in status text but must not arm the parent interrupt (#65343).
  if (child) return { phase: "idle", status: child }
  return { phase: "idle", status: "" }
}

export interface ToolSummaryRow {
  label: string
  tool: string
  inputPreview: string
  elapsedMs: number
}

export function activeToolSummaries(tabs: FooterSubagentTab[], now: number): ToolSummaryRow[] {
  // One row per running subagent. When a tool is executing, show the tool and the time since it
  // started. Between tool calls (thinking/writing) there is no tool, so show "thinking" and the
  // time since the subagent last updated — a stalled subagent (e.g. a downed MCP server) makes
  // that timer grow, which is the signal this panel exists to surface.
  return tabs
    .filter((tab) => tab.status === "running")
    .map((tab) => {
      const hasTool = tab.activeTool !== undefined
      const since = hasTool ? tab.toolStart : tab.lastUpdatedAt
      return {
        label: tab.label || tab.sessionID,
        tool: hasTool ? tab.activeTool! : "",
        inputPreview: "",
        elapsedMs: since === undefined ? 0 : Math.max(0, now - since),
      }
    })
}
