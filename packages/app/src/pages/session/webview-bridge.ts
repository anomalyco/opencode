const SEPARATOR = /[\\/]+/

const split = (value: string) => value.split(SEPARATOR).filter(Boolean)

const clean = (value: string) => value.trim().replace(/\\/g, "/")

const regexEscape = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")

export function normalizeBridgePath(directory: string, value: string): string | undefined {
  const root = clean(directory).replace(/\/+$/, "")
  const input = clean(value)
  if (!root || !input) return

  const isAbs = input.startsWith("/") || /^[A-Za-z]:\//.test(input)
  const absolute = isAbs ? input : `${root}/${input.replace(/^\.\//, "")}`
  const parts = [] as string[]
  for (const piece of split(absolute)) {
    if (piece === ".") continue
    if (piece === "..") {
      parts.pop()
      continue
    }
    parts.push(piece)
  }

  const normalized = absolute.startsWith("/") ? `/${parts.join("/")}` : parts.join("/")

  if (normalized === root) return ""
  if (!normalized.startsWith(`${root}/`)) return
  return normalized.slice(root.length + 1)
}

export function matchScope(path: string, scope: string): boolean {
  const target = clean(path).replace(/^\.\//, "")
  const rule = clean(scope).replace(/^\.\//, "")
  if (!target || !rule) return false
  if (rule === "*") return true
  let pattern = "^"
  let i = 0
  while (i < rule.length) {
    const char = rule[i]
    const next = rule[i + 1]
    if (char === "*" && next === "*") {
      pattern += ".*"
      i += 2
      continue
    }
    if (char === "*") {
      pattern += "[^/]*"
      i += 1
      continue
    }
    pattern += regexEscape(char)
    i += 1
  }
  pattern += "$"
  return new RegExp(pattern).test(target)
}

export function inScopes(path: string, scopes: string[]): boolean {
  if (!scopes.length) return false
  return scopes.some((scope) => matchScope(path, scope))
}

export function isAllowedOrigin(origin: string, origins: string[]): boolean {
  if (origins.includes("*")) return true
  if (origin === "null") return origins.includes("null")
  let current: URL
  try {
    current = new URL(origin)
  } catch {
    return false
  }

  return origins.some((allowed) => {
    try {
      const rule = new URL(allowed)
      if (rule.protocol !== current.protocol) return false
      if (rule.hostname !== current.hostname) return false
      if (rule.port) return rule.port === current.port
      return true
    } catch {
      return false
    }
  })
}

export async function hashText(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}
