export function sidebarSessionIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\/session\/([^/?#]+)/)
  if (!match?.[1]) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}
