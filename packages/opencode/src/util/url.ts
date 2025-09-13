export function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

export function buildCopilotApiUrl(domain: string): string {
  return `https://copilot-api.${domain}`
}
