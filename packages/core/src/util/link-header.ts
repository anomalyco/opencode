export function parseLinkHeader(header: string): Record<string, string> {
  if (!header) return {}
  const links: Record<string, string> = {}
  const parts = header.split(/,(?=\s*<)/)
  for (const part of parts) {
    const section = part.split(";")
    if (section.length < 2) continue
    const url = section[0].replace(/<(.*?)>/, "$1").trim()

    for (const attr of section.slice(1)) {
      const match = attr.match(/rel=["']?(?<rel>[^"']+)["']?/)
      if (match?.groups?.rel) {
        links[match.groups.rel.trim()] = url
        break
      }
    }
  }
  return links
}

export function linkParam(url: string | undefined, key: string) {
  if (!url || !URL.canParse(url)) return undefined
  return new URL(url).searchParams.get(key) ?? undefined
}

export function stripLinkCredentials(url: URL) {
  const next = new URL(url)
  next.searchParams.delete("auth_token")
  return next
}
