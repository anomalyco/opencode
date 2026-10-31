const markup = /<\s*(!doctype|html|head|body|title|h1|p|div|center|br|pre)\b/i

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

function decode(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return entities[entity.toLowerCase()] ?? match
  })
}

/**
 * One line of human-readable text for an error notice.
 *
 * Upstream errors can carry an entire HTML page (an nginx 503, for example).
 * The retry and error notices are single lines in the TUI, so the page is
 * reduced to its title (or heading) and any markup, entities and runs of
 * whitespace are stripped. Plain messages are kept, shortened to `limit`.
 */
export function noticeText(input: string | undefined, limit = 200): string {
  if (!input) return "provider error"

  let text = input
  if (markup.test(text)) {
    text =
      text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
      text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
      text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
  }

  text = decode(text).replace(/\s+/g, " ").trim()
  if (!text) return "provider error"
  if (text.length <= limit) return text
  return text.slice(0, limit - 1).trimEnd() + "…"
}
