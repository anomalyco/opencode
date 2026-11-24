// Shared by the console proxy and the stats app so both agree on which requests get Markdown.
export function prefersMarkdown(accept: string | null | undefined) {
  if (!accept) return false
  const weights = new Map(
    accept.split(",").map((part) => {
      const fields = part.split(";").map((value) => value.trim().toLowerCase())
      const quality = fields.slice(1).find((field) => field.startsWith("q="))
      return [fields[0] ?? "", quality ? Number(quality.slice(2)) : 1] as const
    }),
  )
  const markdown = Math.max(weights.get("text/markdown") ?? 0, weights.get("text/x-markdown") ?? 0)
  return markdown > 0 && markdown >= (weights.get("text/html") ?? 0)
}
