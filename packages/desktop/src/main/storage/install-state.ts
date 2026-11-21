import { isStoreFile } from "./legacy"

export function hasExistingAppState(entries: Array<{ name: string; directory: boolean }>) {
  return entries.some((entry) => {
    if (entry.name === "opencode.settings") return true

    if (isStoreFile(entry.name)) return true

    if (entry.name === "drafts.sqlite") return true

    if (/^window-state-.+\.json$/.test(entry.name)) return true

    return entry.directory && entry.name === "opencode"
  })
}
