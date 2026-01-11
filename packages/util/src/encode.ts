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

export async function hash(content: string, algorithm = "SHA-256"): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest(algorithm, data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  return hashHex
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

export function decodeGitQuotepath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  const input = value.slice(1, -1)

  const append = (bytes: number[], value: number) => bytes.concat(value)

  const parse = (index: number, bytes: number[]): number[] => {
    if (index >= input.length) return bytes
    const char = input[index]
    if (char !== "\\") {
      return parse(index + 1, append(bytes, input.charCodeAt(index)))
    }

    const rest = input.slice(index + 1)
    const octalMatch = rest.match(/^([0-7]{1,3})/)
    if (octalMatch) {
      return parse(index + 1 + octalMatch[1].length, append(bytes, parseInt(octalMatch[1], 8)))
    }

    const next = input[index + 1]
    if (!next) return parse(index + 1, bytes)

    const decoded = (() => {
      if (next === "\\") return 92
      if (next === '"') return 34
      if (next === "n") return 10
      if (next === "t") return 9
      if (next === "r") return 13
      return next.charCodeAt(0)
    })()
    return parse(index + 2, append(bytes, decoded))
  }

  const bytes = parse(0, [])
  return new TextDecoder().decode(new Uint8Array(bytes))
}
