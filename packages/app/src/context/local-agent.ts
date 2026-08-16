export function hasCustomAgent(items: Array<{ native?: boolean }>) {
  return items.some((item) => item.native === false)
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}

// An agent carries a configured model, so applying an agent also overwrites the
// active model. Re-applying the already-persisted agent must therefore be skipped,
// otherwise a control that re-emits the current agent silently discards an explicit
// model pick. The first write for an agent must still land, so this compares against
// persisted state rather than the resolved current agent (which falls back to build).
export function shouldApplyAgent(input: { agent: string; persisted: string | undefined }) {
  return input.persisted !== input.agent
}
