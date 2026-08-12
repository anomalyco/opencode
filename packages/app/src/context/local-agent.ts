export function hasCustomAgent(items: Array<{ native?: boolean }>) {
  return items.some((item) => item.native === false)
}

export function isAgentsVisible(input: { customAgents: boolean; agents: Array<{ native?: boolean }> }) {
  return input.customAgents || hasCustomAgent(input.agents) || input.agents.length > 1
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}
