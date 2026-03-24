// Minimal semver shim for browser
export function valid(version: string): string | null {
  const match = /^v?(\d+\.\d+\.\d+)/.exec(version)
  return match ? match[1] : null
}

export function gt(a: string, b: string): boolean {
  const pa = (valid(a) || "0.0.0").split(".").map(Number)
  const pb = (valid(b) || "0.0.0").split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true
    if (pa[i] < pb[i]) return false
  }
  return false
}

export function gte(a: string, b: string): boolean {
  return a === b || gt(a, b)
}

export function lt(a: string, b: string): boolean {
  return gt(b, a)
}

export function satisfies(_version: string, _range: string): boolean {
  return true // Always satisfied in browser demo
}

export function coerce(version: string): { version: string } | null {
  const v = valid(version)
  return v ? { version: v } : null
}

export function parse(version: string): any {
  const v = valid(version)
  if (!v) return null
  const [major, minor, patch] = v.split(".").map(Number)
  return { major, minor, patch, version: v }
}

export default { valid, gt, gte, lt, satisfies, coerce, parse }
