export type PluginEntry = { raw: string; name: string; version?: string }

export function parsePluginSpecifier(value: string): PluginEntry {
  if (value.startsWith("file://")) {
    const path = value.substring("file://".length)
    const parts = path.split("/")
    const file = parts.pop() || path
    if (!file.includes(".")) return { raw: value, name: file }
    const base = file.split(".")[0]
    if (base !== "index") return { raw: value, name: base }
    const dir = parts.pop()
    return { raw: value, name: dir || base }
  }

  const index = value.lastIndexOf("@")
  if (index <= 0) return { raw: value, name: value }
  const name = value.substring(0, index)
  const version = value.substring(index + 1)
  return { raw: value, name, version }
}
