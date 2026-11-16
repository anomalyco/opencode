export function resolveExternalURL(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)

  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") return url.href

  return undefined
}
