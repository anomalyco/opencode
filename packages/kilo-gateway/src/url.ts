export function normalizeKiloOpenRouterURL(url: string): string {
  if (!url.includes("/openrouter")) return url

  if (url.includes("/api/openrouter")) return url

  return url.replace("/openrouter", "/api/openrouter")
}
