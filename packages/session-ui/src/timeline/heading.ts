export function reasoningHeading(text: string): string | undefined {
  const markdown = text.replace(/\r\n?/g, "\n")
  const html = lastHeading(markdown, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (value) => value.replace(/<[^>]+>/g, " "))
  const atx = lastHeading(markdown, /^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/gm)
  const setext = lastHeading(markdown, /^([^\n]+)\n(?:=+|-+)\s*$/gm)
  const strong = lastHeading(markdown, /^\s*(?:\*\*((?:(?!\*\*).)+)\*\*|__((?:(?!__).)+)__)\s*$/gm)

  const latest = [html, atx, strong].reduce<HeadingMatch | undefined>(
    (best, current) => (!best || (current && current.index >= best.index) ? current : best),
    undefined,
  )

  return (latest ?? setext)?.value
}

type HeadingMatch = { index: number; value: string }

function lastHeading(
  markdown: string,
  pattern: RegExp,
  transform?: (value: string) => string,
): HeadingMatch | undefined {
  return Array.from(markdown.matchAll(pattern)).reduce<HeadingMatch | undefined>((best, match) => {
    const raw = match[1] ?? match[2] ?? ""
    const value = cleanHeading(transform ? transform(raw) : raw)

    return value ? { index: match.index, value } : best
  }, undefined)
}

function cleanHeading(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}
