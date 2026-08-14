export function base64Encode(value: string) {
  const bytes = new TextEncoder().encode(value)
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("")
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function base64Decode(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function checksum(content: string): string | undefined {
  if (!content) return undefined
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function sampledChecksum(content: string, limit = 500_000): string | undefined {
  if (!content) return undefined
  if (content.length <= limit) return checksum(content)

  const size = 4096
  const points = [
    0,
    Math.floor(content.length * 0.25),
    Math.floor(content.length * 0.5),
    Math.floor(content.length * 0.75),
    content.length - size,
  ]
  const hashes = points
    .map((point) => {
      const start = Math.max(0, Math.min(content.length - size, point - Math.floor(size / 2)))
      return checksum(content.slice(start, start + size)) ?? ""
    })
    .join(":")
  return `${content.length}:${hashes}`
}
