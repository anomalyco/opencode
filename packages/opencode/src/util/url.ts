export function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}
