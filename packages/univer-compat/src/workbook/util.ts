export function plain(o: unknown): o is Record<string, unknown> {
  return o !== null && typeof o === "object" && !Array.isArray(o)
}

export function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
