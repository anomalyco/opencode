export * as ConfigPreset from "./preset.js"

type Entry =
  | {
      type: "document"
      info: { providers?: Readonly<Record<string, { models?: Readonly<Record<string, { modelID?: string }>> }>> }
    }
  | { type: "directory" }

// Entries are ordered from lowest to highest priority; omitted targets inherit earlier mappings.
export function models(entries: readonly Entry[]) {
  const presets = new Set<string>()
  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [provider, config] of Object.entries(entry.info.providers ?? {})) {
      for (const [id, model] of Object.entries(config.models ?? {})) {
        if (model.modelID === undefined) continue
        const key = `${provider}:${id}`
        if (model.modelID === id) presets.delete(key)
        else presets.add(key)
      }
    }
  }
  return presets
}
