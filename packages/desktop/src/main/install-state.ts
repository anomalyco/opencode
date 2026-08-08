export function hasExistingAppState(entries: Array<{ name: string; isDirectory: () => boolean }>) {
  return entries.some((entry) => {
    // Current Jarvis stores
    if (entry.name === "jarvis.settings") return true
    if (entry.name.endsWith(".dat")) return true
    if (/^window-state-.+\.json$/.test(entry.name)) return true
    // Legacy OpenCode stores (migration detection)
    if (entry.name === "opencode.settings") return true
    return entry.isDirectory() && entry.name === "opencode"
  })
}
