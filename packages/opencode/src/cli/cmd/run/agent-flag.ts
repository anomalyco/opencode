export type RunAgentListEntry = {
  readonly name: string
  readonly mode?: string
}

export type ResolveRequestedRunAgentResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: "not_found" | "subagent"; readonly names: string[] }

export function matchRunAgent(
  requested: string,
  agents: readonly RunAgentListEntry[],
): RunAgentListEntry | undefined {
  const exact = agents.find((agent) => agent.name === requested)
  if (exact) return exact
  const lower = requested.toLowerCase()
  return agents.find((agent) => agent.name.toLowerCase() === lower)
}

export function primaryRunAgentNames(agents: readonly RunAgentListEntry[]): string[] {
  return agents.filter((agent) => agent.mode !== "subagent").map((agent) => agent.name)
}

export function resolveRequestedRunAgent(
  requested: string,
  agents: readonly RunAgentListEntry[],
): ResolveRequestedRunAgentResult {
  const names = primaryRunAgentNames(agents)
  const matched = matchRunAgent(requested, agents)
  if (!matched) {
    return { ok: false, reason: "not_found", names }
  }
  if (matched.mode === "subagent") {
    return { ok: false, reason: "subagent", names }
  }
  return { ok: true, name: matched.name }
}

export function formatUnknownRunAgentError(
  requested: string,
  result: Extract<ResolveRequestedRunAgentResult, { ok: false }>,
): string {
  const list = result.names.length > 0 ? result.names.join(", ") : "(none)"
  if (result.reason === "subagent") {
    return `agent "${requested}" is a subagent, not a primary agent. Registered primary agents: ${list}`
  }
  return `agent "${requested}" not found. Registered primary agents: ${list}`
}
