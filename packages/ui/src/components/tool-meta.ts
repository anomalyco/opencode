function text(value: unknown) {
  if (typeof value !== "string") return
  const next = value.trim()
  if (!next) return
  return next
}

export function normalizeTool(tool: string) {
  const name = text(tool)?.toLowerCase() ?? "tool"
  if (name === "terminal") return "bash"
  if (name === "read_file") return "read"
  if (name === "web_search") return "websearch"
  return name
}

export function hookName(input: Record<string, unknown>, metadata: Record<string, unknown>) {
  const keys = ["hook", "hook_name", "hookName", "event", "name"]
  for (const src of [metadata, input]) {
    for (const key of keys) {
      const value = text(src?.[key])
      if (!value) continue
      if (value.includes("-")) return value
      if (value === "session-start") return value
    }
  }

  const desc = text(input.description) ?? text(metadata.description)
  if (!desc) return
  const match = desc.match(/([a-z0-9]+(?:-[a-z0-9]+){1,})/i)
  if (!match?.[1]) return
  return match[1]
}

export function hookMeta(input: Record<string, unknown>, metadata: Record<string, unknown>) {
  const keys = ["hook", "hook_name", "hookName", "hook_type", "hookType", "event", "stage", "phase"]
  for (const src of [metadata, input]) {
    for (const key of keys) {
      if (text(src?.[key])) return true
    }
  }
  return false
}

export function isCustomHookTool(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>) {
  const name = normalizeTool(tool)
  if (name !== "bash" && name !== "hook") return false
  return hookMeta(input, metadata) || !!hookName(input, metadata)
}
