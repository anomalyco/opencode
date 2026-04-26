const defaults: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
}

const themeColors: Record<string, string> = {
  primary: "var(--syntax-info)",
  secondary: "var(--syntax-property)",
  accent: "var(--syntax-info)",
  success: "var(--syntax-success)",
  warning: "var(--syntax-warning)",
  error: "var(--text-diff-delete-base)",
  info: "var(--syntax-info)",
}

const palette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]

function tone(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}

function resolveCustomColor(custom?: string) {
  if (!custom) return
  const token = themeColors[custom.toLowerCase()]
  if (token) return token
  if (globalThis.CSS?.supports?.("color", custom)) return custom
}

export function agentColor(name: string, custom?: string) {
  const resolved = resolveCustomColor(custom)
  if (resolved) return resolved
  return defaults[name] ?? defaults[name.toLowerCase()] ?? tone(name.toLowerCase())
}

export function messageAgentColor(
  list: readonly { role: string; agent?: string }[] | undefined,
  agents: readonly { name: string; color?: string }[],
) {
  if (!list) return undefined
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.role !== "user" || !item.agent) continue
    return agentColor(item.agent, agents.find((agent) => agent.name === item.agent)?.color)
  }
}
