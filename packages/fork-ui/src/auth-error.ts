type AuthInitError = {
  name: string
  data: Record<string, unknown>
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val == "bigint") return val.toString()
      if (typeof val == "object" && val) {
        if (seen.has(val)) return "[Circular]"
        seen.add(val)
      }
      return val
    },
    2,
  )
  return json ?? String(value)
}

export function formatAuthInitError(error: AuthInitError): string | undefined {
  const data = error.data
  switch (error.name) {
    case "MCPFailed":
      return `MCP server "${data.name}" failed. Note, opencode does not support MCP authentication yet.`
    case "ProviderAuthError": {
      const providerID = typeof data.providerID == "string" ? data.providerID : "unknown"
      const message = typeof data.message == "string" ? data.message : safeJson(data.message)
      return `Provider authentication failed (${providerID}): ${message}`
    }
    default:
      return undefined
  }
}
