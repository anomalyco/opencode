import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Provider } from "@/provider/provider"
import { SessionTier } from "./tier"

// Structural doom-loop stop (B4): when a minimal-tier model repeats the same
// tool call, a permission ask is useless — the model that loops is exactly the
// model that cannot act on the ask. Instead the offending tool is stripped
// from the session's next STRIP_REQUESTS provider requests and the model gets
// an explicit recovery instruction as the tool error output. The public
// permission Action enum ("ask" | "allow" | "deny") stays untouched, so
// frontier and default tiers keep today's doom_loop semantics; the strip only
// replaces what would have been an "ask" on the minimal tier.
export const STRIP_REQUESTS = 2

// sessionID -> tool -> remaining requests to strip. Per-instance in-memory
// state, like overflow.ts's learned session context limits.
const stripped = new Map<string, Map<string, number>>()

export function shouldStrip(action: PermissionV1.Rule["action"], model: Provider.Model) {
  return action === "ask" && SessionTier.resolve(model) === "minimal"
}

export function strip(sessionID: string, tool: string) {
  const tools = stripped.get(sessionID) ?? new Map<string, number>()
  tools.set(tool, STRIP_REQUESTS)
  stripped.set(sessionID, tools)
}

// Tools stripped for the request being prepared; counts the request against
// each tool's remaining strip budget.
export function consume(sessionID: string) {
  const tools = stripped.get(sessionID)
  if (!tools) return new Set<string>()
  const active = new Set(tools.keys())
  for (const [tool, remaining] of tools) {
    if (remaining <= 1) tools.delete(tool)
    else tools.set(tool, remaining - 1)
  }
  if (!tools.size) stripped.delete(sessionID)
  return active
}

export function recovery(tool: string) {
  return `Tool ${tool} disabled after repeated identical calls. Do not call ${tool} again this turn. Summarize what you have and finish.`
}

export * as DoomLoop from "./doom-loop"
