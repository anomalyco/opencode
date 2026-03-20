export type PluginSpec = {
  name: string
  version?: string
  raw?: string
}

function fileName(value: string) {
  try {
    const path = decodeURIComponent(new URL(value).pathname)
    const parts = path.split("/").filter(Boolean)
    const file = parts[parts.length - 1] ?? path
    const base = file.replace(/\.[^.]+$/, "")
    if (base === "index" && parts.length > 1) {
      return parts[parts.length - 2]
    }
    return base || value
  } catch {
    return value
  }
}

function pkgName(value: string): PluginSpec {
  const at = value.lastIndexOf("@")
  if (at <= 0) return { name: value, version: "latest" }
  return {
    name: value.slice(0, at),
    version: value.slice(at + 1),
  }
}

export function pluginSpec(value: string): PluginSpec {
  if (value.startsWith("file://")) {
    return {
      name: fileName(value),
      raw: value,
    }
  }
  return pkgName(value)
}
