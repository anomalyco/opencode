export function hasExistingAppState(entries: Array<{ name: string; isDirectory: () => boolean }>) {
  return entries.some((entry) => {
    if (entry.name === "opencode.settings") return true
    if (!entry.isDirectory() && (entry.name === "default.dat" || /^opencode\..+\.dat$/.test(entry.name))) return true
    if (/^window-state-.+\.json$/.test(entry.name)) return true
    return entry.isDirectory() && entry.name === "opencode"
  })
}
