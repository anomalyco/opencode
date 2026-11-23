export function agentLabel(agent: string | undefined, visible: boolean) {
  return visible && agent ? agent[0]?.toUpperCase() + agent.slice(1) : ""
}
