/**
 * Parse RFC 8288 Link header into a map of rel -> URL
 * @see https://www.rfc-editor.org/rfc/rfc8288
 */
export function parseLinkHeader(header: string): Record<string, string> {
  if (!header) return {}
  try {
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
  } catch {
    return {}
  }
}
