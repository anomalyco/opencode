const protocols = new Set(["http:", "https:", "mailto:"])

export function isSafeExternalUrl(value: unknown) {
  if (typeof value !== "string" || !URL.canParse(value)) return false
  return protocols.has(new URL(value).protocol)
}
