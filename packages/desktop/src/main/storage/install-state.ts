export function hasExistingAppState(entries: Array<{ name: string; directory: boolean }>) {
  return entries.some((entry) => {
    if (entry.name === "opencode.settings") return true
    if (entry.name.endsWith(".dat")) return true
    if (/^window-state-.+\.json$/.test(entry.name)) return true
    return entry.directory && entry.name === "opencode"
  })
}
