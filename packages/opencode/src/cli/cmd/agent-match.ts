export type AgentSummary = {
  name: string
}

export function matchAgentName(name: string, agents: AgentSummary[]) {
  const exact = agents.find((item) => item.name === name)
  if (exact) return exact.name

  const lowered = name.toLowerCase()
  const match = agents.find((item) => item.name.toLowerCase() === lowered)
  return match?.name
}
