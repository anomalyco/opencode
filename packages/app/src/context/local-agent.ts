export function hasCustomAgent(items: Array<{ native?: boolean }>) {
  return items.some((item) => item.native === false)
}

export function shouldShowAgentSelector(
  items: Array<{ name: string; native?: boolean }>,
  configured: boolean,
) {
  return configured || hasCustomAgent(items) || items.some((item) => item.name === "heavy" || item.name === "council")
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}
