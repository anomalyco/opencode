export function providerAuthUrl(url: string, provider: string, platform: "web" | "desktop") {
  if (provider !== "opencode" || platform !== "desktop") return url
  const result = new URL(url)
  result.searchParams.set("application", "OpenCode Desktop")
  return result.href
}
