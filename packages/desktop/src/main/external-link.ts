const allowedProtocols = new Set(["https:", "http:"])

export function safeExternalUrl(value: string) {
  if (!URL.canParse(value)) return
  const url = new URL(value)
  if (!allowedProtocols.has(url.protocol)) return
  return url.toString()
}
